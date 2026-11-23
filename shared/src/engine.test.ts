import { test } from "node:test";
import assert from "node:assert/strict";
import { compute } from "./engine.ts";
import { DEFAULT_THRESHOLDS } from "./thresholds.ts";
import { sampleRows, SAMPLE_PROPERTIES } from "./sample.ts";
import { validateRow, parseCsv, toCsv, DATASETS } from "./datasets.ts";

test("sample data is valid for every dataset", () => {
  const rows = sampleRows("2026-10-08");
  for (const def of DATASETS) for (const r of rows[def.key]) assert.equal(validateRow(def.key, r), null, `${def.key} ${JSON.stringify(r)}`);
});

test("engine ranks buildings and produces KPI tiles", () => {
  const d = compute({ asOf: "2026-10-08", properties: SAMPLE_PROPERTIES, rows: sampleRows("2026-10-08"), thresholds: DEFAULT_THRESHOLDS });
  assert.equal(d.properties.length, 5);
  assert.equal(d.period.label, "Sep 2026");
  for (let i = 1; i < d.properties.length; i++) {
    const a = d.properties[i - 1], b = d.properties[i];
    assert.ok(a.red > b.red || (a.red === b.red && a.score >= b.score));
  }
  const worst = d.properties[0];
  assert.ok(worst.red > 0, "worst building has red KPIs");
  assert.ok(["Plaza B", "Hall E", "Annex C"].includes(worst.name));
  assert.equal(d.history.months.length, 6);
});

test("leadtime compliance counts open past-target work orders", () => {
  const rows = {
    m: [
      { ticket: "1", property: "X", date_opened: "2026-09-02", target_date: "2026-09-05", status: "Closed", date_closed: "2026-09-04" },
      { ticket: "2", property: "X", date_opened: "2026-09-02", target_date: "2026-09-05", status: "Closed", date_closed: "2026-09-08" },
      { ticket: "3", property: "X", date_opened: "2026-10-01", target_date: "2026-10-03", status: "Open", date_closed: "" },
    ],
  };
  const d = compute({ asOf: "2026-10-08", properties: [{ name: "X", section: "S" }], rows, thresholds: DEFAULT_THRESHOLDS });
  const k = d.properties[0].kpis.find((x) => x.key === "m1")!;
  assert.equal(k.value, "33%");
  assert.equal(k.level, "r");
});

test("validation rules", () => {
  assert.match(validateRow("m", { ticket: "a", property: "X", date_opened: "2026-01-01", target_date: "2026-01-02", status: "Closed" })!, /date closed/);
  assert.match(validateRow("up", { property: "X", system: "Power", month: "2026-10", planned_hours: "10", downtime_hours: "20" })!, /between 0/);
  assert.match(validateRow("bg", { property: "X", month: "2026-1", budget: "5" })!, /2026-10/);
  assert.equal(validateRow("pr", { property: "X", permit: "P", expiry: "2026-12-01" }), null);
});

test("csv round trip", () => {
  const rows = [{ property: "Tower A", permit: 'Fire, "cert"', agency: "", expiry: "2027-01-01", renewal_status: "", owner: "", reason: "", action_taken: "" }];
  const back = parseCsv(toCsv("pr", rows));
  assert.deepEqual(back[0], rows[0]);
});
