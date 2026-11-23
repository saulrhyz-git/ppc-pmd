import { test } from "node:test";
import assert from "node:assert/strict";
import { allowedMoves, legacyRowToWo, woToLegacyRow } from "./workorders.ts";

const sup = { id: "s", role: "Supervisor" as const };
const tech = { id: "t", role: "Technician" as const };

test("technicians move only work orders assigned to them, and never close or cancel", () => {
  assert.deepEqual(allowedMoves(tech, { status: "Assigned", assigneeIds: ["x"] }), []);
  assert.deepEqual(allowedMoves(tech, { status: "Assigned", assigneeIds: ["t"] }), ["In Progress", "On Hold"]);
  assert.deepEqual(allowedMoves(tech, { status: "In Progress", assigneeIds: ["t"] }), ["On Hold", "Completed"]);
  assert.deepEqual(allowedMoves(tech, { status: "Completed", assigneeIds: ["t"] }), []);
});

test("supervisors verify, close, reopen and cancel", () => {
  assert.ok(allowedMoves(sup, { status: "Completed", assigneeIds: [] }).includes("Closed"));
  assert.ok(allowedMoves(sup, { status: "Closed", assigneeIds: [] }).includes("In Progress"));
  assert.ok(allowedMoves(sup, { status: "On Hold", assigneeIds: [] }).includes("Cancelled"));
});

test("old register rows convert to work orders and back", () => {
  const row = { ticket: "WO-1", property: "Tower A", description: "Leak", activity_type: "Preventive", date_opened: "2026-01-05", target_date: "2026-01-08", status: "Closed", date_closed: "2026-01-07", owner: "Eng. A", est_cost: "1,200", chargeable_to_tenant: "Yes" };
  const w = legacyRowToWo(row, "2026-02-01");
  assert.equal(w.status, "Closed");
  assert.equal(w.estCost, 1200);
  assert.equal(w.chargeable, true);
  const back = woToLegacyRow({ ...w, holdReason: "", assignees: [] });
  assert.equal(back.status, "Closed");
  assert.equal(back.date_closed, "2026-01-07");
  assert.equal(back.owner, "Eng. A");
  assert.equal(legacyRowToWo({ property: "Tower A", date_opened: "bad" }, "2026-02-01").dateOpened, "2026-02-01");
});
