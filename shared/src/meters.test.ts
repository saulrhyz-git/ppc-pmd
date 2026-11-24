import { test } from "node:test";
import assert from "node:assert/strict";
import { MD, completeness, energyBalance, runMeters, useBetween, type EngineMeter, type EngineReading } from "./meters.ts";

const meter = (id: string, over: Partial<EngineMeter> = {}): EngineMeter => ({
  id, code: id, meterClass: "Tenant", multiplier: 1, rolloverAt: null, expectedDaily: true, activeFrom: "2026-01-01", activeTo: null, propertyId: "P", ...over,
});
/** Daily readings from 2026-01-01 using the given daily use (a function of day index). */
function series(meterId: string, days: number, use: (i: number) => number, start = 1000): EngineReading[] {
  const out: EngineReading[] = [];
  let v = start;
  for (let i = 0; i < days; i++) {
    if (i > 0) v += use(i);
    out.push({ id: `${meterId}-${i}`, meterId, date: MD.add("2026-01-01", i), value: Math.round(v * 100) / 100 });
  }
  return out;
}

test("steady use: no exceptions and correct consumption", () => {
  const r = series("A", 40, () => 100);
  const run = runMeters([meter("A")], r, [], { from: "2026-01-01", to: "2026-02-09" });
  assert.equal(run.exceptions.length, 0);
  assert.equal(run.meters.A.baselinePerDay, 100);
  assert.equal(useBetween(run.meters.A, "2026-01-02", "2026-01-31").use, 3000);
});

test("a reading lower than the previous one is Critical and not counted", () => {
  const r = series("A", 10, () => 50);
  r[5] = { ...r[5], value: r[4].value - 10 };
  const run = runMeters([meter("A")], r, [], { from: "2026-01-01", to: "2026-01-10" });
  const neg = run.exceptions.filter((x) => x.code === "NEGATIVE");
  assert.equal(neg.length, 1);
  assert.equal(neg[0].severity, "Critical");
  // Day 6 measures from day 4's value, so the total is unchanged: 9 intervals x 50.
  assert.equal(useBetween(run.meters.A, "2026-01-01", "2026-01-10").use, 450);
});

test("replacement event keeps consumption right across the new register", () => {
  const r: EngineReading[] = [
    { id: "1", meterId: "A", date: "2026-01-01", value: 5000 },
    { id: "2", meterId: "A", date: "2026-01-02", value: 5100 },
    { id: "3", meterId: "A", date: "2026-01-03", value: 30 }, // new meter started at 0, old one ended at 5170
  ];
  const ev = [{ meterId: "A", date: "2026-01-03", type: "Replacement", prevReading: 5170, newReading: 0 }];
  const run = runMeters([meter("A")], r, ev, { from: "2026-01-01", to: "2026-01-03" });
  assert.equal(run.exceptions.filter((x) => x.code === "NEGATIVE").length, 0);
  assert.equal(run.meters.A.intervals[1].use, 100);
});

test("rollover is suggested when the register wraps near its limit", () => {
  const r: EngineReading[] = [
    { id: "1", meterId: "A", date: "2026-01-01", value: 999950 },
    { id: "2", meterId: "A", date: "2026-01-02", value: 40 },
  ];
  const run = runMeters([meter("A", { rolloverAt: 999999.9 })], r, [], { from: "2026-01-01", to: "2026-01-02" });
  assert.match(run.exceptions[0].check, /rolled over/);
});

test("missing days are reported with their streak, and a multi-day gap is spread evenly", () => {
  const r = series("A", 10, () => 100).filter((x) => x.date !== "2026-01-05" && x.date !== "2026-01-06");
  const run = runMeters([meter("A")], r, [], { from: "2026-01-01", to: "2026-01-10" });
  const miss = run.exceptions.filter((x) => x.code === "MISSING").sort((a, b) => a.date.localeCompare(b.date));
  assert.deepEqual(miss.map((x) => [x.date, x.streak, x.severity]), [["2026-01-06", 2, "High"]]);
  assert.deepEqual(run.meters.A.missing, { "2026-01-05": 1, "2026-01-06": 2 });
  assert.equal(useBetween(run.meters.A, "2026-01-05", "2026-01-05").use, 100);
  assert.equal(useBetween(run.meters.A, "2026-01-05", "2026-01-05").estimatedDays, 1);
});

test("a spike against a reliable baseline is High; with a short history it is only a Warning", () => {
  const long = series("A", 40, (i) => (i === 39 ? 300 : 100));
  const run = runMeters([meter("A")], long, [], { from: "2026-02-09", to: "2026-02-09" });
  assert.equal(run.exceptions[0].code, "HIGH_USE");
  assert.equal(run.exceptions[0].severity, "High");
  const short = series("B", 12, (i) => (i === 11 ? 300 : 100));
  const run2 = runMeters([meter("B")], short, [], { from: "2026-01-12", to: "2026-01-12" });
  assert.equal(run2.exceptions[0].severity, "Warning");
  // Too little history: no check at all.
  const tiny = series("C", 4, (i) => (i === 3 ? 300 : 100));
  assert.equal(runMeters([meter("C")], tiny, [], { from: "2026-01-04", to: "2026-01-04" }).exceptions.length, 0);
});

test("zero use against a normal baseline is flagged", () => {
  const r = series("A", 30, (i) => (i === 29 ? 0 : 80));
  const run = runMeters([meter("A")], r, [], { from: "2026-01-30", to: "2026-01-30" });
  assert.equal(run.exceptions[0].code, "ZERO_USE");
});

test("multiplier applies to the utility main, and the energy balance finds the losses", () => {
  const main = meter("M", { meterClass: "Utility Main", multiplier: 10 });
  const t1 = meter("T1"), ca = meter("CA", { meterClass: "Common Area" });
  const r = [...series("M", 11, () => 100), ...series("T1", 11, () => 700), ...series("CA", 11, () => 230)];
  const run = runMeters([main, t1, ca], r, [], { from: "2026-01-01", to: "2026-01-11" });
  const [b] = energyBalance([main, t1, ca], run, "2026-01-02", "2026-01-11");
  assert.equal(b.main, 10000);
  assert.equal(b.others, 700);
  assert.equal(b.othersPct, 7);
  assert.equal(b.level, "amber");
});

test("completeness counts readings against expected days in the active period", () => {
  const m = meter("A", { activeFrom: "2026-01-06" });
  const r = series("A", 10, () => 1).filter((x) => x.date !== "2026-01-08");
  assert.deepEqual(completeness(m, r, "2026-01-01", "2026-01-10"), { expected: 5, have: 4, pct: 80 });
});

test("a space that is closed every Sunday is compared with its own Sundays, not flagged each week", () => {
  // 2026-01-04 is a Sunday.
  const r = series("A", 60, (i) => (new Date(MD.p(MD.add("2026-01-01", i))).getUTCDay() === 0 ? 10 : 100));
  const run = runMeters([meter("A")], r, [], { from: "2026-01-25", to: "2026-03-01" });
  assert.deepEqual(run.exceptions, []);
  // A real spike on a Sunday is still caught.
  const r2 = series("B", 60, (i) => (new Date(MD.p(MD.add("2026-01-01", i))).getUTCDay() === 0 ? (i === 59 ? 300 : 10) : 100));
  const last = MD.add("2026-01-01", 59);
  assert.equal(new Date(MD.p(last)).getUTCDay(), 0);
  const ex = runMeters([meter("B")], r2, [], { from: last, to: last }).exceptions;
  assert.equal(ex[0]?.code, "HIGH_USE");
});

test("today's round is not reported missing while it is still open", () => {
  const r = series("A", 9, () => 10);
  const run = runMeters([meter("A")], r, [], { from: "2026-01-01", to: "2026-01-10", missingThrough: "2026-01-09" });
  assert.equal(run.exceptions.filter((x) => x.code === "MISSING").length, 0);
});

test("a two-day gap that includes a closed Sunday is not flagged as low use", () => {
  const isSun = (i: number) => new Date(MD.p(MD.add("2026-01-01", i))).getUTCDay() === 0;
  // Day 52 is a Sunday (2026-02-22); skip its reading so day 53 covers Sunday + Monday.
  assert.ok(isSun(52));
  const r = series("A", 60, (i) => (isSun(i) ? 10 : 100)).filter((x) => x.date !== MD.add("2026-01-01", 52));
  const run = runMeters([meter("A")], r, [], { from: MD.add("2026-01-01", 53), to: MD.add("2026-01-01", 53) });
  assert.deepEqual(run.exceptions.filter((x) => x.code !== "MISSING"), []);
});
