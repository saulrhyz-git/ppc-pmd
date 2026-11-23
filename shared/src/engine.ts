// KPI engine. A TypeScript port of the prototype's applyData() / calc() / sfCalc():
// it turns the raw registers and logs into the per-building KPI tiles, ranking and
// detail lists every screen uses. Pure functions, no I/O, so it is easy to test.

import { parseDate, TRADES, type DatasetKey, type Row } from "./datasets.ts";
import type { Thresholds } from "./thresholds.ts";

export type Level = "r" | "a" | "g";
export const lv = (red: boolean, amber: boolean): Level => (red ? "r" : amber ? "a" : "g");
const DAY = 864e5;
const MN3 = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const r1 = (x: number) => Math.round(x * 10) / 10;
const ym = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
const iso = (d: Date) => ym(d) + "-" + String(d.getDate()).padStart(2, "0");
const yes = (v?: string) => /^y/i.test(v || "");

export interface Kpi {
  key: string;
  label: string;
  value: string;
  level: Level;
  info: string;
  target: string;
}

export interface OpenWO {
  ticket: string; asset: string; description: string; tenant: string; chargeable: string; category: string;
  opened: string; target: string; ageDays: number; pastDays: number; owner: string; reason: string; actionTaken: string; status: string;
}
export interface CompletedWork { id: string; type: string; date: string; description: string; owner: string; asset: string; source: string }
export interface Breakdown { asset: string; start: string; restored: string; hours: number; open: boolean; cause: string; ticket: string; actionTaken: string; delayReason: string }
export interface PmTask { task: string; asset: string; due: string; done: string; critical: boolean; owner: string; reason: string; actionTaken: string; status: "On time" | "Done late" | "Overdue" | "Not due"; daysLate: number }
export interface Permit { permit: string; agency: string; expiry: string; days: number; renewalStatus: string; owner: string; reason: string; actionTaken: string; level: Level }
export interface OpexMonth { month: string; budget: number; actual: number | null; reason: string; actionTaken: string }
export interface Project { id: string; name: string; type: string; description: string; owner: string; start: string; finish: string; pct: number; budget: number; spent: number; nextMilestone: string; delayReason: string; actionTaken: string; plan: number; variance: number; status: string; daysLate: number; forecastDays: number | null; level: Level }
export interface Incident { id: string; date: string; type: string; severity: string; location: string; description: string; injured: number; lostTime: boolean; actionTaken: string; reason: string; target: string; closed: string; owner: string; status: string; level: Level }
export interface UptimeRow { system: string; month: string; planned: number; downtime: number; interruptions: number; uptime: number; reason: string; actionTaken: string }
export interface Slip {
  id: string; trade: string; received: string; responded: string; resolution: string; closedAt: string; requestedBy: string; company: string;
  concern: string; actionTaken: string; workOrder: string; state: "Open" | "With work order" | "Needs work order" | "Closed";
  closed: boolean; resolutionHours: number | null; responseMinutes: number | null; ageHours: number; issues: string[];
}
export interface Contract { no: string; name: string; vendor: string; type: string; start: string; end: string; days: number; value: number; renewalStatus: string; owner: string; reason: string; actionTaken: string; level: Level }
export interface Recurring { asset: string; category: string; count: number; level: Level; reason: string; actionTaken: string }

export interface PropertyResult {
  name: string;
  section: string;
  kpis: Kpi[];
  score: number;
  red: number;
  issues: { level: Level; text: string; key: string }[];
  openWorkOrders: OpenWO[];
  completedWork: CompletedWork[];
  reactive: { reactive: number; preventive: number; requests: number; total: number; pct: number };
  closedInPeriod: { total: number; onTime: number };
  recurring: Recurring[];
  breakdowns: Breakdown[];
  mttr: { count: number; hours: number; downtime: number };
  pm: { total: number; onTime: number; pct: number; flagged: PmTask[]; all: PmTask[] };
  permits: Permit[];
  opex: { ytdBudget: number; ytdActual: number; pct: number; months: OpexMonth[] };
  projects: Project[];
  incidents: Incident[];
  uptime: { month: string; rows: UptimeRow[]; uptime: number | null; interruptions: number };
  slips: Slip[];
  contracts: Contract[];
}

export interface Dashboard {
  asOf: string;
  period: { start: string; end: string; label: string };
  sections: string[];
  properties: PropertyResult[]; // ranked, worst first
  history: { months: string[]; byProperty: Record<string, number[]>; byTrade: Record<string, Record<string, number[]>> };
  rejected: { dataset: DatasetKey; id: string; message: string }[];
}

export interface EngineInput {
  asOf: string; // YYYY-MM-DD
  properties: { name: string; section: string | null }[];
  rows: Partial<Record<DatasetKey, (Row & { _id?: string })[]>>;
  thresholds: Thresholds;
  weights?: Record<string, { r: number; a: number }>;
}

export function compute(input: EngineInput): Dashboard {
  const TH = input.thresholds;
  const asof = new Date(input.asOf + "T08:00");
  const ms = new Date(asof.getFullYear(), asof.getMonth() - 1, 1);
  const me = new Date(asof.getFullYear(), asof.getMonth(), 1);
  const inP = (x: Date) => x >= ms && x < me;
  const prevMonth = ym(ms);
  const prevPrevMonth = ym(new Date(asof.getFullYear(), asof.getMonth() - 2, 1));
  const D = parseDate;
  const rows = (k: DatasetKey) => input.rows[k] ?? [];
  const names = input.properties.map((p) => p.name);
  const has = (n: string) => names.includes(n);
  const dAgo = (s: string) => Math.floor((new Date(input.asOf + "T00:00").getTime() - new Date(String(s).slice(0, 10) + "T00:00").getTime()) / DAY);

  const sections = [...new Set(input.properties.map((p) => p.section || "Unassigned"))];

  // 6-month concern history (by received date)
  const hm: Date[] = [];
  for (let i = 5; i >= 0; i--) hm.push(new Date(asof.getFullYear(), asof.getMonth() - i, 1));
  const history = { months: hm.map((d) => MN3[d.getMonth()] + " " + d.getFullYear()), byProperty: {} as Record<string, number[]>, byTrade: {} as Record<string, Record<string, number[]>> };

  const results: PropertyResult[] = input.properties.map((pp) => {
    const name = pp.name;
    const of = (k: DatasetKey) => rows(k).filter((r) => r.property === name);

    // --- work orders ---
    const openWO: OpenWO[] = [];
    const completed: CompletedWork[] = [];
    const allWO = new Map<string, { status: string; closed: string; asset: string }>();
    let clTotal = 0, clOnTime = 0;
    for (const r of of("m")) {
      const op = D(r.date_opened), tg = D(r.target_date);
      if (!op || !tg) continue;
      const st = (r.status || "").toLowerCase(), cl = D(r.date_closed);
      const ty = /^prev/i.test(r.activity_type || "") ? "Preventive" : /^(req|impr)/i.test(r.activity_type || "") ? "Requests/Improvement" : "Reactive";
      allWO.set(r.ticket, { status: st === "closed" ? "Closed" : "Open", closed: (r.date_closed || "").slice(0, 10), asset: r.asset || "" });
      if (st === "closed") {
        if (cl && inP(cl)) {
          clTotal++;
          if (cl <= tg) clOnTime++;
          completed.push({ id: r.ticket, type: ty, date: r.date_closed.slice(0, 10), description: r.description || "", owner: r.owner || "", asset: r.asset || "", source: "Work order" });
        }
      } else {
        openWO.push({
          ticket: r.ticket, asset: r.asset || "–", description: r.description || "", tenant: r.tenant || "", chargeable: yes(r.chargeable_to_tenant) ? "Yes" : /^n/i.test(r.chargeable_to_tenant || "") ? "No" : "",
          category: r.activity_type || "Reactive", opened: r.date_opened.slice(0, 10), target: r.target_date.slice(0, 10),
          ageDays: Math.max(0, Math.floor((asof.getTime() - op.getTime()) / DAY)), pastDays: Math.max(0, Math.floor((asof.getTime() - tg.getTime()) / DAY)),
          owner: r.owner || "–", reason: r.reason || "", actionTaken: r.action_taken || "", status: r.status || "Open",
        });
      }
    }
    openWO.sort((a, b) => b.pastDays - a.pastDays || b.ageDays - a.ageDays);

    // --- breakdowns (last 90 days) ---
    const breakdowns: Breakdown[] = [];
    for (const r of of("b")) {
      const s = D(r.start);
      if (!s) continue;
      const open = !r.restored;
      const e = open ? asof : D(r.restored);
      if (!e || e < s) continue;
      if (s.getTime() < asof.getTime() - 90 * DAY) continue;
      breakdowns.push({ asset: r.asset, start: r.start, restored: r.restored || "", hours: Math.round((e.getTime() - s.getTime()) / 36e5), open, cause: r.cause || "", ticket: r.ticket || "", actionTaken: r.action_taken || "", delayReason: r.delay_reason || "" });
    }
    const byAsset: Record<string, { h: number; n: number }> = {};
    for (const b of breakdowns) { byAsset[b.asset] ??= { h: 0, n: 0 }; byAsset[b.asset].h += b.hours; byAsset[b.asset].n++; }
    const downtime = breakdowns.reduce((s, b) => s + b.hours, 0);
    const maxOcc = Math.max(0, ...Object.values(byAsset).map((x) => x.n));
    const mttrN = breakdowns.length, mttr = mttrN ? downtime / mttrN : 0;

    // --- recurring: open tickets on the same asset and category ---
    const rc: Record<string, { n: number; reason: string; action: string }> = {};
    for (const w of openWO) {
      if (!w.asset || w.asset === "–") continue;
      const k = w.asset + "|" + w.category;
      rc[k] ??= { n: 0, reason: "", action: "" };
      rc[k].n++;
      rc[k].reason ||= w.reason;
      rc[k].action ||= w.actionTaken;
    }
    const recurring: Recurring[] = Object.entries(rc).filter(([, v]) => v.n >= TH.m5.a).map(([k, v]) => ({ asset: k.split("|")[0], category: k.split("|")[1], count: v.n, level: lv(v.n >= TH.m5.r, v.n >= TH.m5.a), reason: v.reason, actionTaken: v.action })).sort((a, b) => b.count - a.count);
    const recRed = recurring.filter((x) => x.count >= TH.m5.r);

    // --- PM ---
    const pmAll: PmTask[] = [];
    let pmTotal = 0, pmOn = 0;
    for (const r of of("pm")) {
      const du = D(r.due_date);
      if (!du) continue;
      const dn = D(r.done_date);
      if (dn && inP(dn)) completed.push({ id: r.task || "PM task", type: "Preventive", date: r.done_date.slice(0, 10), description: r.task || "PM task", owner: r.owner || "", asset: r.asset || "", source: "PM task" });
      let status: PmTask["status"] = "Not due", late = 0;
      if (dn) { late = Math.max(0, Math.round((dn.getTime() - du.getTime()) / DAY)); status = dn <= du ? "On time" : "Done late"; }
      else if (du < asof) { late = Math.floor((asof.getTime() - du.getTime()) / DAY); status = "Overdue"; }
      const t: PmTask = { task: r.task || "PM task", asset: r.asset || "–", due: r.due_date.slice(0, 10), done: dn ? r.done_date.slice(0, 10) : "", critical: yes(r.critical), owner: r.owner || "", reason: r.reason || "", actionTaken: r.action_taken || "", status, daysLate: late };
      pmAll.push(t);
      if (inP(du)) { pmTotal++; if (status === "On time") pmOn++; }
    }
    const pmFlagged = pmAll.filter((t) => t.status === "Done late" || t.status === "Overdue").sort((a, b) => b.daysLate - a.daysLate);
    const pmPct = pmTotal ? Math.round((pmOn / pmTotal) * 100) : 100;
    const pmCrit = pmFlagged.filter((t) => t.critical);

    // --- permits ---
    const permits: Permit[] = of("pr").flatMap((r) => {
      const x = D(r.expiry);
      if (!x) return [];
      const days = Math.floor((x.getTime() - asof.getTime()) / DAY);
      return [{ permit: r.permit || "Permit", agency: r.agency || "", expiry: r.expiry.slice(0, 10), days, renewalStatus: r.renewal_status || "", owner: r.owner || "", reason: r.reason || "", actionTaken: r.action_taken || "", level: lv(days < 0, days <= TH.m7.a) }];
    }).sort((a, b) => a.days - b.days);
    const worstPermit = permits[0];

    // --- opex ---
    const yr = input.asOf.slice(0, 4), mo = input.asOf.slice(0, 7);
    const months: OpexMonth[] = of("bg").filter((r) => /^\d{4}-\d{2}$/.test(r.month || "")).map((r) => ({ month: r.month, budget: +r.budget || 0, actual: r.actual === "" || r.actual == null ? null : +r.actual, reason: r.reason || "", actionTaken: r.action_taken || "" })).sort((a, b) => (a.month < b.month ? -1 : 1));
    let ytdA = 0, ytdB = 0;
    for (const x of months) if (x.month.slice(0, 4) === yr && x.month <= mo && x.actual != null) { ytdA += x.actual; ytdB += x.budget; }
    const budPct = ytdB ? Math.round((ytdA / ytdB) * 100) : 0;
    const lastNote = [...months].reverse().find((x) => x.month <= mo && (x.reason || x.actionTaken));

    // --- projects ---
    const projects: Project[] = of("pj").flatMap((r, i) => {
      const s = D(r.start_date), f = D(r.finish_date);
      const pct = parseFloat(r.percent_complete);
      if (!s || !f || f <= s || !(pct >= 0 && pct <= 100)) return [];
      const A = new Date(input.asOf + "T00:00");
      const tot = Math.max(1, (f.getTime() - s.getTime()) / DAY), el = (A.getTime() - s.getTime()) / DAY;
      const plan = Math.round(Math.max(0, Math.min(100, (el / tot) * 100))), v = Math.round(pct - plan);
      const stx = (r.status || "").toLowerCase();
      let status: string, late = 0, fc: number | null = null;
      if (pct >= 100 || stx === "completed") status = "Completed";
      else if (stx === "on hold") status = "On hold";
      else if (A < s) status = "Not started";
      else {
        if (pct > 0) fc = Math.round(el / (pct / 100) - tot);
        if (A > f) { late = Math.round((A.getTime() - f.getTime()) / DAY); status = "Delayed"; }
        else status = v >= -TH.pj.a ? "On time" : v >= -TH.pj.r ? "At risk" : "Delayed";
      }
      const level: Level = status === "Delayed" ? "r" : status === "At risk" || status === "On hold" ? "a" : "g";
      return [{ id: r.project_id || "PRJ-" + (i + 1), name: r.project, type: r.type || "Project", description: r.description || "", owner: r.owner || "", start: r.start_date.slice(0, 10), finish: r.finish_date.slice(0, 10), pct, budget: +r.budget || 0, spent: +r.spent || 0, nextMilestone: r.next_milestone || "", delayReason: r.delay_reason || "", actionTaken: r.action_taken || "", plan, variance: v, status, daysLate: late, forecastDays: fc, level }];
    });
    const delayed = projects.filter((p) => p.status === "Delayed"), atRisk = projects.filter((p) => p.status === "At risk" || p.status === "On hold");

    // --- incidents ---
    const incidents: Incident[] = of("inc").flatMap((r) => {
      if (!D(r.date)) return [];
      const closed = (r.closed_date || "").slice(0, 10), target = (r.target_date || "").slice(0, 10);
      const past = !closed && !!target && dAgo(target) > 0;
      const sev = r.severity || "Minor";
      return [{ id: r.incident_id, date: r.date.slice(0, 10), type: r.type || "Other", severity: sev, location: r.location || "", description: r.description || "", injured: +r.injured || 0, lostTime: yes(r.lost_time), actionTaken: r.action_taken || "", reason: r.reason || "", target, closed, owner: r.owner || "", status: closed ? "Closed " + closed : past ? "Open · " + dAgo(target) + " d past target" : "Open", level: (sev === "Major" || sev === "Critical" ? "r" : sev === "Moderate" ? "a" : "g") as Level }];
    }).sort((a, b) => (a.date < b.date ? 1 : -1));
    const incCur = incidents.filter((x) => x.date.slice(0, 7) === prevMonth).length;
    const incBase = incidents.filter((x) => x.date.slice(0, 7) === prevPrevMonth).length;
    const incRed = incBase > 0 ? r1(((incBase - incCur) / incBase) * 100) : incCur ? -100 : 0;

    // --- uptime (latest month on or before as-of) ---
    const upRows: UptimeRow[] = of("up").filter((r) => (r.month || "") <= mo && +r.planned_hours > 0).map((r) => ({ system: r.system, month: r.month, planned: +r.planned_hours, downtime: +r.downtime_hours || 0, interruptions: +r.interruptions || 0, uptime: ((+r.planned_hours - (+r.downtime_hours || 0)) / +r.planned_hours) * 100, reason: r.reason || "", actionTaken: r.action_taken || "" }));
    const upMonth = upRows.reduce((a, x) => (x.month > a ? x.month : a), "");
    const upLatest = upRows.filter((x) => x.month === upMonth);
    const upV = upLatest.length ? Math.round((upLatest.reduce((a, x) => a + x.uptime, 0) / upLatest.length) * 100) / 100 : null;
    const upN = upLatest.reduce((a, x) => a + x.interruptions, 0);

    // --- concern slips ---
    const usedWO: Record<string, number> = {};
    for (const r of of("cs")) if (r.work_order) usedWO[r.work_order] = (usedWO[r.work_order] || 0) + 1;
    const slips: Slip[] = of("cs").flatMap((r) => {
      const rc0 = D(r.date_received);
      if (!rc0) return [];
      const rs = D(r.date_responded), cc = D(r.date_closed), re = D(r.resolution_date);
      const wo = r.work_order ? allWO.get(r.work_order) : undefined;
      const issues: string[] = [];
      let state: Slip["state"], clAt: Date | null = null;
      if (wo) {
        if (usedWO[r.work_order] > 1) issues.push(`Work order ${r.work_order} is used by ${usedWO[r.work_order]} slips (one slip, one work order)`);
        if (wo.status === "Closed") { state = "Closed"; clAt = wo.closed ? D(wo.closed + "T23:59") : null; } else state = "With work order";
      } else if (r.work_order) { state = "Needs work order"; issues.push(`Work order ${r.work_order} is not in the work orders log`); }
      else if (cc) { state = "Closed"; clAt = cc; }
      else state = "Open";
      const closed = state === "Closed";
      const trade = (TRADES as readonly string[]).includes(r.trade) ? r.trade : "Other";
      return [{
        id: r.control_no, trade, received: r.date_received, responded: r.date_responded || "", resolution: r.resolution_date || "", closedAt: clAt ? iso(clAt) : "",
        requestedBy: r.requested_by || "", company: r.company || "", concern: r.concern || "", actionTaken: r.action_taken || "", workOrder: r.work_order || "", state, closed,
        resolutionHours: re && re >= rc0 ? (re.getTime() - rc0.getTime()) / 36e5 : closed && clAt ? (clAt.getTime() - rc0.getTime()) / 36e5 : null,
        responseMinutes: rs ? (rs.getTime() - rc0.getTime()) / 6e4 : null, ageHours: (asof.getTime() - rc0.getTime()) / 36e5, issues,
      }];
    });
    const slipsP = slips.filter((s) => inP(D(s.received)!));
    const crL = slipsP.filter((s) => !s.workOrder), crD = crL.filter((s) => s.resolutionHours != null || (!s.closed && s.ageHours > TH.rs.a)), crOk = crD.filter((s) => s.resolutionHours != null && s.resolutionHours <= TH.rs.a);
    const crV = crD.length ? Math.round((crOk.length / crD.length) * 100) : null;
    const rtR = slipsP.filter((s) => s.responseMinutes != null), rtV = rtR.length ? rtR.reduce((a, s) => a + s.responseMinutes!, 0) / rtR.length : null;
    const rtNone = slipsP.length - rtR.length;

    history.byProperty[name] = hm.map((m) => slips.filter((s) => { const d = D(s.received)!; return d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); }).length);
    history.byTrade[name] = Object.fromEntries(TRADES.map((t) => [t, hm.map((m) => slips.filter((s) => { const d = D(s.received)!; return s.trade === t && d.getFullYear() === m.getFullYear() && d.getMonth() === m.getMonth(); }).length)]));

    // --- contracts ---
    const contracts: Contract[] = of("ct").flatMap((r) => {
      const e = D(r.end_date);
      if (!e) return [];
      const days = Math.floor((e.getTime() - asof.getTime()) / DAY);
      return [{ no: r.contract_no || "", name: r.contract || "Contract", vendor: r.vendor || "", type: r.contract_type || "", start: (r.start_date || "").slice(0, 10), end: r.end_date.slice(0, 10), days, value: +r.value || 0, renewalStatus: r.renewal_status || "", owner: r.owner || "", reason: r.reason || "", actionTaken: r.action_taken || "", level: lv(days < 0, days <= TH.ct.a) }];
    }).sort((a, b) => a.days - b.days);

    // --- reactive share of completed work ---
    let rwR = 0, rwV = 0, rwQ = 0;
    for (const c of completed) { if (c.type === "Preventive") rwV++; else if (c.type === "Requests/Improvement") rwQ++; else rwR++; }
    const rwT = rwR + rwV + rwQ, rwX = rwT ? Math.round((rwR / rwT) * 100) : 0;

    // --- leadtime compliance: closed within target ÷ (closed in period + open past target) ---
    const pastOpen = openWO.filter((x) => x.pastDays > 0).length;
    const m1 = clTotal + pastOpen ? Math.round((clOnTime / (clTotal + pastOpen)) * 100) : 100;

    const kpis: Kpi[] = [
      { key: "m1", label: "Concerns Agreed Leadtime Compliance", value: m1 + "%", level: lv(m1 < TH.m1.r, m1 < TH.m1.a), info: `Concerns agreed leadtime compliance ${m1}% (target ${TH.m1.a}%)`, target: `Target ≥ ${TH.m1.a}%` },
      { key: "up", label: "Critical system uptime", value: upV == null ? "–" : upV + "%", level: upV == null ? "g" : lv(upN >= 2 || upV < TH.up.r, upN === 1 || upV < TH.up.a), info: upV == null ? "No uptime recorded" : `Critical system uptime ${upV}% (${upMonth})` + (upN ? `; ${upN} unplanned service interruption${upN === 1 ? "" : "s"}${upN >= 2 ? " (rating capped at Red)" : " (rating capped at Amber)"}` : ""), target: `Target ≥ ${TH.up.a}%` },
      { key: "m4", label: "Breakdowns / asset", value: maxOcc + (maxOcc === 1 ? " occurrence" : " occurrences"), level: lv(maxOcc >= TH.m4.r, maxOcc >= TH.m4.a), info: `${maxOcc} breakdown occurrence${maxOcc === 1 ? "" : "s"} on one asset in 90 days`, target: `Target < ${TH.m4.a}` },
      { key: "m5", label: "Recurring Concerns", value: recRed.length + (recRed.length === 1 ? " asset" : " assets"), level: lv(recRed.length >= 1, recurring.length > 0), info: recRed.map((r) => `${r.asset} ${r.category} x${r.count}`).join(", ") || (recurring.length ? "Pre-warning: " + recurring.map((r) => `${r.asset} x${r.count}`).join(", ") : "No recurring concerns"), target: `Target: no asset with ${TH.m5.a}+` },
      { key: "m6", label: "PM compliance", value: pmPct + "%", level: lv(pmPct < TH.m6.r, pmPct < TH.m6.a), info: `PM compliance ${pmPct}% (${pmTotal - pmOn} tasks late or missed)` + (pmCrit.length ? ". Critical-asset PM missed (information only): " + pmCrit.slice(0, 2).map((t) => t.task).join(", ") : ""), target: `Target ≥ ${TH.m6.a}%` },
      { key: "m7", label: "Permit Compliance", value: !worstPermit ? "–" : worstPermit.days < 0 ? "Expired" : worstPermit.days + " d", level: worstPermit ? worstPermit.level : "g", info: !worstPermit ? "No permit on file for this building" : worstPermit.permit + (worstPermit.days < 0 ? " expired" : ` expires in ${worstPermit.days} days`), target: `Renew > ${TH.m7.a} d before expiry` },
      { key: "m11", label: "Budget Monitoring", value: budPct + "%", level: lv(budPct > TH.m11.r, budPct > TH.m11.a), info: `Operating expenses at ${budPct}% of budget year to date` + (lastNote?.reason ? ` (${lastNote.reason})` : ""), target: `Target ≤ ${TH.m11.a}%` },
      { key: "mt", label: "MTTR (h)", value: mttrN ? r1(mttr) + " h" : "–", level: mttrN ? lv(mttr > TH.mt.r, mttr > TH.mt.a) : "g", info: mttrN ? `Mean time to restore ${r1(mttr)} h across ${mttrN} breakdown${mttrN === 1 ? "" : "s"} (target ${TH.mt.a} h or less)` : "No breakdowns recorded", target: `Target ≤ ${TH.mt.a} h` },
      { key: "rw", label: "Reactive work orders", value: rwT ? rwX + "%" : "–", level: rwT ? lv(rwX > TH.rw.r, rwX > TH.rw.a) : "g", info: rwT ? `Reactive work orders are ${rwX}% of the work completed last month (${rwR} reactive, ${rwV} preventive, ${rwQ} requests/improvement; target ${TH.rw.a}% or less)` : "No work completed last month", target: `Target ≤ ${TH.rw.a}%` },
      { key: "cr", label: "Routine concerns resolved in 24 h", value: crV == null ? "–" : crV + "%", level: crV == null ? "g" : lv(crV < TH.cr.r, crV < TH.cr.a), info: crV == null ? "No routine concerns to measure last month" : `${crV}% of routine tenant concerns resolved within ${TH.rs.a} hours (${crOk.length} of ${crD.length}; target ${TH.cr.a}% or more)`, target: `Target ≥ ${TH.cr.a}%` },
      { key: "cx", label: "Concerns Response Time", value: rtV == null ? "–" : r1(rtV) + " min", level: rtV == null ? "g" : lv(rtV > TH.cx.r, rtV > TH.cx.a), info: rtV == null ? "No concerns responded to last month" : `Average response time ${r1(rtV)} minutes across ${rtR.length} concern${rtR.length === 1 ? "" : "s"} last month (target ${TH.cx.a} min or less)` + (rtNone ? `; ${rtNone} with no response recorded` : ""), target: `Target ≤ ${TH.cx.a} min` },
      { key: "pj", label: "CAPEX / projects", value: !projects.length ? "–" : delayed.length ? delayed.length + " delayed" : atRisk.length ? atRisk.length + " at risk" : "On plan", level: lv(delayed.length > 0, atRisk.length > 0), info: !projects.length ? "No projects on file" : delayed.length ? `${delayed.length} project${delayed.length === 1 ? "" : "s"} delayed: ${delayed.slice(0, 2).map((p) => p.name).join(", ")}` : atRisk.length ? `${atRisk.length} project${atRisk.length === 1 ? "" : "s"} at risk or on hold` : "All projects on plan", target: `Within ${TH.pj.a} pts of plan` },
      { key: "ct", label: "Contracts", value: !contracts.length ? "–" : contracts[0].days < 0 ? contracts.filter((c) => c.days < 0).length + " expired" : contracts[0].days + " d", level: contracts.length ? contracts[0].level : "g", info: !contracts.length ? "No contracts on file" : contracts[0].days < 0 ? `${contracts[0].name} contract expired ${-contracts[0].days} days ago` : `${contracts[0].name} contract ends in ${contracts[0].days} days`, target: `Renew > ${TH.ct.a} d before end` },
      { key: "s1", label: "Monthly incident reduction", value: incBase > 0 ? incRed + "%" : incCur ? incCur + " new" : "0", level: incBase > 0 ? lv(incRed < TH.s1.r, incRed < TH.s1.a) : incCur ? "r" : "g", info: incBase > 0 ? `Safety and security: incidents in ${prevMonth}: ${incCur} vs ${incBase} in ${prevPrevMonth}, ${incRed >= 0 ? "a reduction of " : "an increase of "}${Math.abs(incRed)}% (target ${TH.s1.a}% reduction or more)` : incCur ? `Safety and security: ${incCur} incident(s) in ${prevMonth} and none in ${prevPrevMonth}` : `No incidents in ${prevMonth} or ${prevPrevMonth}`, target: `Target ≥ ${TH.s1.a}% reduction` },
    ];

    const w = input.weights?.[name] ?? { r: 3, a: 1 };
    const score = kpis.reduce((s, k) => s + (k.level === "r" ? w.r : k.level === "a" ? w.a : 0), 0);
    const red = kpis.filter((k) => k.level === "r").length;
    const issues = kpis.filter((k) => k.level !== "g").map((k) => ({ level: k.level, text: k.info, key: k.key })).sort((a, b) => Number(b.level === "r") - Number(a.level === "r"));

    return {
      name, section: pp.section || "Unassigned", kpis, score, red, issues,
      openWorkOrders: openWO, completedWork: completed, reactive: { reactive: rwR, preventive: rwV, requests: rwQ, total: rwT, pct: rwX },
      closedInPeriod: { total: clTotal, onTime: clOnTime }, recurring, breakdowns, mttr: { count: mttrN, hours: r1(mttr), downtime },
      pm: { total: pmTotal, onTime: pmOn, pct: pmPct, flagged: pmFlagged, all: pmAll }, permits,
      opex: { ytdBudget: ytdB, ytdActual: ytdA, pct: budPct, months }, projects, incidents,
      uptime: { month: upMonth, rows: upLatest, uptime: upV, interruptions: upN }, slips, contracts,
    };
  });

  results.sort((a, b) => b.red - a.red || b.score - a.score);

  // rows referring to buildings that don't exist
  const rejected: Dashboard["rejected"] = [];
  for (const [k, list] of Object.entries(input.rows) as [DatasetKey, (Row & { _id?: string })[]][]) for (const r of list) if (r.property && !has(r.property)) rejected.push({ dataset: k, id: r._id || "", message: `Unknown building "${r.property}"` });

  return { asOf: input.asOf, period: { start: iso(ms), end: iso(new Date(me.getTime() - DAY)), label: MN3[ms.getMonth()] + " " + ms.getFullYear() }, sections, properties: results, history, rejected };
}
