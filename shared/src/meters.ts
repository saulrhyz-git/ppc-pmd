// Meter reading checks and consumption. Deterministic and side-effect free; the server and the
// browser both run it. Nothing here changes a reading: corrections are made by voiding and
// re-entering a reading, or by logging a meter event (replacement / rollover).
//
// Order of trust: validated readings > register differences > baseline statistics.
import type { MeterClass } from "./assets.ts";

const DAY = 864e5;
export const MD = {
  p: (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)),
  f: (t: number) => new Date(t).toISOString().slice(0, 10),
  add: (s: string, n: number) => MD.f(MD.p(s) + n * DAY),
  diff: (a: string, b: string) => Math.round((MD.p(b) - MD.p(a)) / DAY),
  range(a: string, b: string) {
    const out: string[] = [];
    for (let s = a; s <= b; s = MD.add(s, 1)) out.push(s);
    return out;
  },
  monthRange(month: string): [string, string] {
    const y = +month.slice(0, 4), m = +month.slice(5, 7);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return [`${month}-01`, `${month}-${String(last).padStart(2, "0")}`];
  },
  prevMonth(month: string) {
    let y = +month.slice(0, 4), m = +month.slice(5, 7) - 1;
    if (!m) { m = 12; y--; }
    return `${y}-${String(m).padStart(2, "0")}`;
  },
};

export interface MeterThresholds {
  /** Days of history used for the baseline (median of valid daily use). */
  baselineDays: number;
  /** Fewer valid days than this: no consumption check at all. */
  minBaselineDays: number;
  /** Fewer valid days than this: the baseline is provisional and flags are capped at Warning (except zero use). */
  reliableBaselineDays: number;
  /** Ratio to baseline. Inside lo..hi is normal; outside redLo..redHi is High; between is Warning. */
  normalLo: number;
  normalHi: number;
  redLo: number;
  redHi: number;
  /** Below this ratio counts as "very low" (High). */
  veryLow: number;
  /** Energy balance: unaccounted use as % of the utility main meter. */
  lossGreen: number;
  lossAmber: number;
  /** Completeness below this % of expected readings is flagged. */
  completenessAmber: number;
}

export const DEFAULT_METER_THRESHOLDS: MeterThresholds = {
  baselineDays: 30, minBaselineDays: 7, reliableBaselineDays: 21,
  normalLo: 0.7, normalHi: 1.3, redLo: 0.5, redHi: 2.0, veryLow: 0.2,
  lossGreen: 5, lossAmber: 8, completenessAmber: 95,
};

export function mergeMeterThresholds(v: Partial<MeterThresholds> | null | undefined): MeterThresholds {
  const out = { ...DEFAULT_METER_THRESHOLDS };
  for (const k of Object.keys(out) as (keyof MeterThresholds)[]) {
    const x = v?.[k];
    if (typeof x === "number" && isFinite(x) && x >= 0) out[k] = x;
  }
  return out;
}

export interface EngineMeter {
  id: string;
  code: string;
  meterClass: MeterClass;
  multiplier: number;
  rolloverAt: number | null;
  expectedDaily: boolean;
  activeFrom: string;
  activeTo: string | null;
  propertyId: string;
}
export interface EngineReading { id: string; meterId: string; date: string; value: number }
export interface EngineEvent { meterId: string; date: string; type: string; prevReading: number | null; newReading: number | null }

export type ExceptionCode = "NEGATIVE" | "MISSING" | "HIGH_USE" | "LOW_USE" | "ZERO_USE" | "OUTSIDE_ACTIVE";
export type Severity = "Critical" | "High" | "Warning";
export const EXCEPTION_LABEL: Record<ExceptionCode, string> = {
  NEGATIVE: "Reading lower than previous",
  MISSING: "Missing reading",
  HIGH_USE: "High use vs baseline",
  LOW_USE: "Low use vs baseline",
  ZERO_USE: "Zero use",
  OUTSIDE_ACTIVE: "Reading outside active period",
};

export interface MeterException {
  id: string;
  code: ExceptionCode;
  label: string;
  severity: Severity;
  meterId: string;
  date: string;
  readingId: string | null;
  what: string;
  check: string;
  /** Consecutive missing days (MISSING only). */
  streak?: number;
  ratio?: number;
  perDay?: number;
  baseline?: number;
}

export interface Interval {
  meterId: string;
  readingId: string;
  prevDate: string;
  date: string;
  prev: number;
  cur: number;
  /** Consumption for the interval, after events and the multiplier. */
  use: number;
  days: number;
  perDay: number;
  events: string[];
  /** False when the interval is negative and cannot be counted. */
  counted: boolean;
}

export interface MeterResult {
  meterId: string;
  intervals: Interval[];
  /** Latest valid register value and its date. */
  last: { date: string; value: number } | null;
  /** Expected-but-missing dates in the window, with the streak length on each. */
  missing: Record<string, number>;
  baselinePerDay: number | null;
}

export interface MeterRun {
  from: string;
  to: string;
  meters: Record<string, MeterResult>;
  exceptions: MeterException[];
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const fmt = (x: number) => x.toLocaleString("en-US", { maximumFractionDigits: 2 });
const median = (a: number[]) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y), k = s.length >> 1;
  return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2;
};

/**
 * Validates readings and works out consumption for each meter.
 * Readings before `from` are used as the starting point and for the baseline; exceptions are
 * reported only for dates in [from, to]. Pass at least `baselineDays` of history before `from`.
 */
export function runMeters(
  meters: EngineMeter[],
  readings: EngineReading[],
  events: EngineEvent[],
  /** missingThrough: last date checked for missing readings (default `to`); pass yesterday while today's round is still open. */
  window: { from: string; to: string; missingThrough?: string },
  th: MeterThresholds = DEFAULT_METER_THRESHOLDS,
): MeterRun {
  const { from, to } = window;
  const exceptions: MeterException[] = [];
  const out: Record<string, MeterResult> = {};
  const inWindow = (d: string) => d >= from && d <= to;
  const push = (e: Omit<MeterException, "id" | "label">) => {
    if (!inWindow(e.date)) return;
    exceptions.push({ ...e, id: `${e.code}-${e.meterId}-${e.date}`, label: EXCEPTION_LABEL[e.code] });
  };

  const byMeter = new Map<string, EngineReading[]>();
  for (const r of readings) {
    if (!byMeter.has(r.meterId)) byMeter.set(r.meterId, []);
    byMeter.get(r.meterId)!.push(r);
  }
  const evByMeter = new Map<string, EngineEvent[]>();
  for (const e of events) {
    if (!evByMeter.has(e.meterId)) evByMeter.set(e.meterId, []);
    evByMeter.get(e.meterId)!.push(e);
  }

  for (const m of meters) {
    const list = (byMeter.get(m.id) ?? []).filter((r) => r.date <= to).sort((a, b) => a.date.localeCompare(b.date));
    const evs = (evByMeter.get(m.id) ?? []).sort((a, b) => a.date.localeCompare(b.date));
    const mult = m.multiplier > 0 ? m.multiplier : 1;
    const res: MeterResult = { meterId: m.id, intervals: [], last: null, missing: {}, baselinePerDay: null };
    out[m.id] = res;

    // Register events between two readings, in date order, with the register before and after.
    const between = (a: string, b: string) => evs.filter((e) => e.date > a && e.date <= b && e.prevReading != null && e.newReading != null);

    let prev: { date: string; value: number } | null = null;
    const valid: { date: string; perDay: number }[] = []; // intervals used for baselines
    const singles: { date: string; perDay: number; dow: number }[] = []; // every one-day interval, for weekday patterns
    for (const r of list) {
      if (r.date < m.activeFrom || (m.activeTo && r.date > m.activeTo)) {
        push({ code: "OUTSIDE_ACTIVE", severity: "Warning", meterId: m.id, date: r.date, readingId: r.id,
          what: `Reading dated ${r.date} is outside the meter's active period (${m.activeFrom} to ${m.activeTo ?? "now"}).`,
          check: "Check the reading date, or the meter's Active from / Active to dates in the meter list." });
      }
      if (!prev) { prev = { date: r.date, value: r.value }; res.last = prev; continue; }
      const evList = between(prev.date, r.date);
      let raw = 0, base = prev.value;
      for (const e of evList) { raw += (e.prevReading as number) - base; base = e.newReading as number; }
      raw += r.value - base;
      const use = r2(raw * mult);
      const days = Math.max(1, MD.diff(prev.date, r.date));
      const iv: Interval = { meterId: m.id, readingId: r.id, prevDate: prev.date, date: r.date, prev: prev.value, cur: r.value, use, days, perDay: r2(use / days), events: evList.map((e) => e.type), counted: use >= 0 };
      res.intervals.push(iv);
      if (use < 0) {
        const nearRoll = m.rolloverAt != null && prev.value > m.rolloverAt * 0.9 && r.value < m.rolloverAt * 0.1;
        push({ code: "NEGATIVE", severity: "Critical", meterId: m.id, date: r.date, readingId: r.id,
          what: `Reading ${fmt(r.value)} is lower than the previous reading ${fmt(prev.value)} (${prev.date}).`,
          check: nearRoll
            ? "The register looks like it rolled over. Log a Rollover event with the final and start values."
            : "Re-read the meter. If the meter was replaced or rolled over, log the event; if the reading is wrong, void it and enter the right value." });
        // Keep the previous good value as the starting point; the bad reading is not counted.
        continue;
      }
      // Baseline from earlier valid intervals (median use per day, last N days).
      const since = MD.add(r.date, -th.baselineDays);
      const hist = valid.filter((v) => v.date >= since).map((v) => v.perDay);
      const overall = median(hist);
      // Same weekday over the last 5 weeks: spaces closed on Sundays, or open longer on Saturdays,
      // are compared with their own pattern instead of raising an alarm every week. An interval
      // spanning several days is compared with the average of its weekdays.
      const dow = new Date(MD.p(r.date)).getUTCDay();
      const wdMedian = (w: number) => {
        const xs = singles.filter((v) => v.dow === w && v.date >= MD.add(r.date, -35)).map((v) => v.perDay);
        return xs.length >= 3 ? median(xs) : null;
      };
      let weekday: number | null = null;
      if (overall != null) {
        let sum = 0, any = false;
        for (let k = 0; k < days; k++) {
          const w = wdMedian(new Date(MD.p(r.date) - k * DAY).getUTCDay());
          if (w != null) any = true;
          sum += w ?? overall;
        }
        weekday = any ? sum / days : null;
      }
      const ratioTo = (x: number) => (x > 0 ? iv.perDay / x : iv.perDay > 0 ? Infinity : 1);
      const dist = (x: number) => (x === 0 || !isFinite(x) ? Infinity : Math.abs(Math.log(x)));
      const useWeekday = weekday != null && overall != null && dist(ratioTo(weekday)) < dist(ratioTo(overall));
      const b = useWeekday ? weekday : overall;
      let flagged = false;
      if (days === 1) singles.push({ date: r.date, perDay: iv.perDay, dow });
      if (b != null && overall != null && hist.length >= th.minBaselineDays) {
        const reliable = hist.length >= th.reliableBaselineDays;
        const ratio = ratioTo(b);
        const per = days > 1 ? ` (${fmt(use)} over ${days} days)` : "";
        const usual = useWeekday ? `usual for this weekday (${fmt(b)} per day)` : `usual ${fmt(b)} per day`;
        const base = { meterId: m.id, date: r.date, readingId: r.id, ratio: isFinite(ratio) ? r2(ratio) : undefined, perDay: iv.perDay, baseline: r2(b) };
        const note = reliable ? "" : ` Baseline is provisional (${hist.length} days), so this is capped at Warning.`;
        if (iv.perDay === 0 && b > 0) {
          flagged = true;
          push({ ...base, code: "ZERO_USE", severity: "High",
            what: `No consumption recorded${per}; ${useWeekday ? "this weekday usually uses" : "usual use is"} about ${fmt(b)} per day.`,
            check: "Check whether the space is closed or the supply is off. If the space is operating, the meter may be faulty." });
        } else if (ratio > th.normalHi) {
          flagged = true;
          const sev: Severity = ratio > th.redHi && reliable ? "High" : "Warning";
          push({ ...base, code: "HIGH_USE", severity: sev,
            what: `Use of ${fmt(iv.perDay)} per day${per} is ${isFinite(ratio) ? fmt(r2(ratio)) + "×" : "far above"} the ${usual}.${note}`,
            check: "Re-read the meter to rule out a misread, then ask the occupant about added equipment or extended hours." });
        } else if (ratio < th.normalLo) {
          flagged = true;
          const sev: Severity = ratio < th.redLo && reliable ? "High" : "Warning";
          const very = ratio < th.veryLow;
          push({ ...base, code: "LOW_USE", severity: sev,
            what: `${very ? "Very low. " : ""}Use of ${fmt(iv.perDay)} per day${per} is only ${fmt(r2(ratio))}× the ${usual}.${note}`,
            check: "Check whether the space was closed. If it was operating, re-read the meter and check for a bypass or a faulty meter." });
        }
      }
      // Flagged days do not feed the baseline, so one spike does not hide the next.
      if (!flagged) valid.push({ date: r.date, perDay: iv.perDay });
      prev = { date: r.date, value: r.value };
      res.last = prev;
    }
    res.baselinePerDay = (() => {
      const since = MD.add(to, -th.baselineDays);
      const h = valid.filter((v) => v.date > since).map((v) => v.perDay);
      const b = median(h);
      return h.length >= th.minBaselineDays && b != null ? r2(b) : null;
    })();

    // Missing readings: every active day without a reading (for meters read daily). One exception
    // per gap, dated on the gap's last day, so a meter that is not read for a week is one line.
    if (m.expectedDaily) {
      const have = new Set(list.map((r) => r.date));
      const last = window.missingThrough && window.missingThrough < to ? window.missingThrough : to;
      const start = m.activeFrom > MD.add(from, -th.baselineDays) ? m.activeFrom : MD.add(from, -th.baselineDays);
      let gapStart: string | null = null, streak = 0;
      const close = (end: string) => {
        if (gapStart && inWindow(end)) {
          push({ code: "MISSING", severity: streak >= 2 ? "High" : "Warning", meterId: m.id, date: end, readingId: null, streak,
            what: streak >= 2 ? `No readings for ${m.code} for ${streak} days in a row (${gapStart} to ${end}).` : `No reading for ${m.code} on ${end}.`,
            check: "Read the meter. The use for the gap will be counted from the next reading." });
        }
        gapStart = null; streak = 0;
      };
      let prevDay = "";
      for (const d of MD.range(start, last)) {
        const inactive = d < m.activeFrom || (m.activeTo && d > m.activeTo);
        if (inactive || have.has(d)) { if (gapStart) close(prevDay); prevDay = d; continue; }
        if (!gapStart) gapStart = d;
        streak++;
        if (inWindow(d)) res.missing[d] = streak;
        prevDay = d;
      }
      if (gapStart) close(prevDay);
    }
  }

  const rank: Record<Severity, number> = { Critical: 0, High: 1, Warning: 2 };
  exceptions.sort((a, b) => b.date.localeCompare(a.date) || rank[a.severity] - rank[b.severity] || a.meterId.localeCompare(b.meterId));
  return { from, to, meters: out, exceptions };
}

/**
 * Consumption of one meter between two dates (inclusive), spreading intervals that span several
 * days evenly over those days. Negative intervals are not counted.
 */
export function useBetween(res: MeterResult, from: string, to: string): { use: number; estimatedDays: number } {
  let use = 0, estimatedDays = 0;
  const a = MD.p(from), b = MD.p(to);
  for (const iv of res.intervals) {
    if (!iv.counted) continue;
    // Interval covers the days (prevDate, date].
    const s = MD.p(iv.prevDate) + DAY, e = MD.p(iv.date);
    const lo = Math.max(s, a), hi = Math.min(e, b);
    if (hi < lo) continue;
    const n = Math.round((hi - lo) / DAY) + 1;
    use += iv.perDay * n;
    if (iv.days > 1) estimatedDays += n;
  }
  return { use: r2(use), estimatedDays };
}

/** Share of expected readings that were taken in [from, to]. */
export function completeness(m: EngineMeter, readings: EngineReading[], from: string, to: string) {
  if (!m.expectedDaily) return null;
  const s = m.activeFrom > from ? m.activeFrom : from;
  const e = m.activeTo && m.activeTo < to ? m.activeTo : to;
  if (e < s) return null;
  const expected = MD.diff(s, e) + 1;
  const have = new Set(readings.filter((r) => r.meterId === m.id && r.date >= s && r.date <= e).map((r) => r.date)).size;
  return { expected, have, pct: r2((have / expected) * 100) };
}

export interface BalanceResult {
  propertyId: string;
  main: number;
  tenant: number;
  commonArea: number;
  others: number;
  othersPct: number | null;
  level: "green" | "amber" | "red" | "none";
}

/**
 * Energy balance per building: the utility main meter(s) against the sum of tenant and common-area
 * meters. "Others" is unaccounted use plus system losses.
 */
export function energyBalance(meters: EngineMeter[], run: MeterRun, from: string, to: string, th: MeterThresholds = DEFAULT_METER_THRESHOLDS): BalanceResult[] {
  const by = new Map<string, BalanceResult>();
  for (const m of meters) {
    const r = run.meters[m.id];
    if (!r) continue;
    const b = by.get(m.propertyId) ?? { propertyId: m.propertyId, main: 0, tenant: 0, commonArea: 0, others: 0, othersPct: null, level: "none" as const };
    by.set(m.propertyId, b);
    const u = useBetween(r, from, to).use;
    if (m.meterClass === "Utility Main") b.main += u;
    else if (m.meterClass === "Common Area") b.commonArea += u;
    else b.tenant += u;
  }
  for (const b of by.values()) {
    b.main = r2(b.main); b.tenant = r2(b.tenant); b.commonArea = r2(b.commonArea);
    if (b.main > 0) {
      b.others = r2(b.main - b.tenant - b.commonArea);
      b.othersPct = r2((b.others / b.main) * 100);
      const a = Math.abs(b.othersPct);
      b.level = a <= th.lossGreen ? "green" : a <= th.lossAmber ? "amber" : "red";
    }
  }
  return [...by.values()];
}
