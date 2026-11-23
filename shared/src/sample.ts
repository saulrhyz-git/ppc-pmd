// Sample data generator used by the database seed and the tests. It produces realistic
// rows for every register, dated relative to the as-of date, so dashboards light up
// with a mix of Red, Amber and Green right after installation.

import type { DatasetKey, Row } from "./datasets.ts";

export const SAMPLE_PROPERTIES: { name: string; section: string }[] = [
  { name: "Tower A", section: "Commercial" },
  { name: "Plaza B", section: "Commercial" },
  { name: "Annex C", section: "Industrial" },
  { name: "Court D", section: "Residential" },
  { name: "Hall E", section: "Residential" },
];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

export function sampleRows(asOf: string): Record<DatasetKey, Row[]> {
  const R = rng(42);
  const pick = <T,>(a: readonly T[]) => a[Math.floor(R() * a.length)];
  const A = new Date(asOf + "T08:00");
  const day = (n: number, h = 9, m = 0) => { const d = new Date(A.getFullYear(), A.getMonth(), A.getDate() - n, h, m); return d; };
  const D = (d: Date) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const DT = (d: Date) => D(d) + " " + String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
  const M = (back: number) => { const d = new Date(A.getFullYear(), A.getMonth() - back, 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); };

  const out: Record<DatasetKey, Row[]> = { cs: [], m: [], b: [], pm: [], pr: [], bg: [], pj: [], inc: [], up: [], ar: [], ct: [], cc: [], tr: [] };
  // "badness" per building: higher means more problems
  const bad: Record<string, number> = { "Tower A": 0.2, "Plaza B": 0.8, "Annex C": 0.6, "Court D": 0.1, "Hall E": 0.7 };
  const assets: Record<string, [string, string, string][]> = {
    "Tower A": [["Lift 1", "Elevator", "Lift lobby"], ["Lift 2", "Elevator", "Lift lobby"], ["Pump 1", "Water / pumps", "Pump room"], ["Genset", "Power / generator", "Genset room"], ["AHU 1", "HVAC", "Roof deck"]],
    "Plaza B": [["Pump 2", "Water / pumps", "Pump room"], ["Lift 1", "Elevator", "Lobby"], ["Genset", "Power / generator", "Basement"], ["Chiller 1", "HVAC", "Roof"], ["Gate", "Security", "Main gate"]],
    "Annex C": [["Chiller 1", "HVAC", "Plant room"], ["Transformer", "Electrical", "Substation"], ["Fire pump", "Fire protection (FDAS / AFSS)", "Pump room"], ["Dock door 2", "Building / civil", "Loading bay"]],
    "Court D": [["AHU 4", "HVAC", "4F"], ["Lift 1", "Elevator", "Lobby"], ["Booster pump", "Water / pumps", "Basement"], ["FDAS panel", "Fire protection (FDAS / AFSS)", "Guard house"]],
    "Hall E": [["Lift 3", "Elevator", "Tower 2"], ["Pump 1", "Water / pumps", "Pump room"], ["Genset", "Power / generator", "Basement"], ["CCTV", "Security", "Guard house"]],
  };
  const tenants: Record<string, string[]> = {
    "Tower A": ["Acme Corp", "Northwind Legal", "Bluebird Travel"],
    "Plaza B": ["Kestrel Foods", "Orion Clinic", "Harbor Bank"],
    "Annex C": ["Delta Logistics", "Granite Works"],
    "Court D": ["Unit 3A owner", "Unit 5C owner", "Unit 7B owner"],
    "Hall E": ["Unit 12F owner", "Unit 8D owner", "Corner Café"],
  };
  const owners = ["Eng. Reyes", "Eng. Santos", "Sup. Cruz", "Tech. Lim"];
  const woDesc: Record<string, string[]> = {
    Elevator: ["Lift door closes slowly", "Lift stops between floors", "Lift button not lighting"],
    "Water / pumps": ["Low water pressure upper floors", "Pump vibration at start-up", "Leak at discharge flange"],
    HVAC: ["Office too warm in the afternoon", "AHU noisy", "Chiller high head pressure"],
    "Power / generator": ["Genset failed weekly test", "Power trip on 3F"],
    Security: ["Gate barrier not lifting", "CCTV camera offline"],
    Electrical: ["Corridor lights flickering", "Breaker trips in pantry"],
    "Fire protection (FDAS / AFSS)": ["FDAS trouble alarm", "Fire pump jockey cycling"],
    "Building / civil": ["Ceiling leak after rain", "Floor tiles loose"],
  };

  let wo = 1000, cs = 1, inc = 1;
  for (const { name } of SAMPLE_PROPERTIES) {
    const b = bad[name];
    const as = assets[name];
    const tn = tenants[name];
    // asset register
    as.forEach(([a, c, loc], i) => out.ar.push({ property: name, asset_tag: name.replace(/\W/g, "").toUpperCase().slice(0, 3) + "-" + (100 + i), asset: a, category: c, location: loc, critical: i < 2 ? "Yes" : "No", status: "In service" }));
    // tenant register
    tn.forEach((t, i) => out.tr.push({ property: name, tenant_id: "T-" + name[0] + (i + 1), tenant: t, unit: (i + 2) + "F", contact_person: "Contact " + (i + 1), contact: "", portal_account: name === "Tower A" && t === "Acme Corp" ? "tenant@example.com" : "", status: "Active" }));

    // work orders over the last 120 days
    const nWO = 45 + Math.round(b * 30);
    for (let i = 0; i < nWO; i++) {
      const [a, c, loc] = pick(as);
      const ago = Math.floor(R() * 120);
      const op = day(ago);
      const lead = pick([2, 3, 5, 7]);
      const tg = day(ago - lead);
      const typeR = R();
      const type = typeR < 0.7 - b * 0.35 ? "Preventive" : typeR < 0.76 - b * 0.35 ? "Requests/Improvement" : "Reactive";
      const closedR = R();
      const open = ago < 20 && closedR < 0.08 + b * 0.3;
      const late = R() < 0.02 + b * 0.3;
      const cl = day(Math.max(0, ago - (late ? lead + 1 + Math.floor(R() * 6) : Math.floor(R() * lead))));
      const t = "WO-" + ++wo;
      out.m.push({
        ticket: t, property: name, description: pick(woDesc[c] || ["General repair"]), activity_type: type, location: loc, asset: a, date_opened: D(op),
        reported_by: pick(["Tenant", "Guard", "Technician", "Supervisor"]), tenant: R() < 0.6 ? pick(tn) : "Common area (no tenant)", root_cause: "", remarks: "",
        est_cost: String(100 * (1 + Math.floor(R() * 20))), chargeable_to_tenant: R() < 0.15 ? "Yes" : "No", target_date: D(tg), status: open ? "Open" : "Closed",
        last_update: open ? "Technician inspected" : "", date_closed: open ? "" : D(cl > A ? A : cl), owner: pick(owners),
        reason: open && tg < A ? pick(["Part not ordered yet", "Waiting for contractor", "Waiting for quote", "Tenant unavailable for access"]) : "",
        action_taken: open ? pick(["Area barricaded", "Temporary fix applied", "Part requested", "Contractor called"]) : "Repaired and tested",
      });
    }
    // a recurring asset problem for bad buildings
    if (b >= 0.6) {
      const [a, c, loc] = as[0];
      for (let k = 0; k < 3; k++) {
        const ago = 3 + k * 7;
        out.m.push({ ticket: "WO-" + ++wo, property: name, description: pick(woDesc[c] || ["Repair"]), activity_type: "Reactive", location: loc, asset: a, date_opened: D(day(ago)), reported_by: "Technician", tenant: "Common area (no tenant)", root_cause: "Worn part", remarks: "", est_cost: "900", chargeable_to_tenant: "No", target_date: D(day(ago - 2)), status: "Open", last_update: "", date_closed: "", owner: "Eng. Santos", reason: "Spare part not in stock", action_taken: "Standby unit running" });
      }
    }

    // concern slips over the last 6 months
    const nCS = 40 + Math.round(b * 25);
    for (let i = 0; i < nCS; i++) {
      const ago = Math.floor(R() * 180);
      const rc = day(ago, 8 + Math.floor(R() * 9), Math.floor(R() * 60));
      const respMin = Math.round(1 + R() * (5 + b * 25));
      const rs = new Date(rc.getTime() + respMin * 6e4);
      const hrs = 1 + R() * (14 + b * 36);
      const res = new Date(rc.getTime() + hrs * 36e5);
      const done = res < A && R() > 0.05;
      const tr = pick(["Elevator", "Water / pumps", "HVAC", "Electrical", "Plumbing", "Security", "Building / civil", "Other"]);
      out.cs.push({
        control_no: "CS-" + String(cs++).padStart(4, "0"), property: name, concern: pick(woDesc[tr] || ["General concern"]), trade: tr, requested_by: "Contact " + (1 + (i % 3)), company: pick(tn),
        received_by: "Admin desk", date_received: DT(rc), responded_by: "Tech. Lim", date_responded: DT(rs), action_taken: done ? "Checked and fixed" : "", resolution_date: done ? DT(res) : "",
        date_closed: done ? DT(res) : "", work_order: "", tenant_account: "", tenant_update: "",
      });
    }

    // breakdowns
    const nBD = 1 + Math.round(b * 3);
    for (let i = 0; i < nBD; i++) {
      const [a] = b >= 0.6 ? as[0] : pick(as);
      const s = day(5 + Math.floor(R() * 80), 6 + Math.floor(R() * 10));
      const h = Math.round(1 + R() * (3 + b * 16));
      out.b.push({ property: name, asset: a, start: DT(s), restored: DT(new Date(s.getTime() + h * 36e5)), cause: pick(["Seal", "Motor", "Sensor", "Controller", "Bearing"]), ticket: "", action_taken: "Repaired", delay_reason: h > 8 ? "Part had to be ordered" : "" });
    }

    // PM tasks: monthly + quarterly for 4 months
    as.forEach(([a], i) => {
      for (let mback = 0; mback < 4; mback++) {
        const due = new Date(A.getFullYear(), A.getMonth() - mback, 5 + i * 4);
        if (due > A) continue;
        const lateR = R();
        const missed = lateR < b * 0.12;
        const late = !missed && lateR < b * 0.3;
        const done = missed ? null : new Date(due.getTime() + (late ? (1 + Math.floor(R() * 5)) : -Math.floor(R() * 2)) * 864e5);
        out.pm.push({ property: name, task: a + " monthly inspection", asset: a, due_date: D(due), done_date: done && done <= A ? D(done) : "", critical: i < 2 ? "Yes" : "No", owner: pick(owners), reason: missed ? "Technician reassigned to breakdown" : late ? "Contractor rescheduled" : "", action_taken: missed ? "Rescheduled" : "", cost: "" });
      }
    });

    // permits
    const pdays = { "Tower A": [90, 300], "Plaza B": [25, 200], "Annex C": [-3, 120], "Court D": [70, 400], "Hall E": [55, 250] }[name]!;
    out.pr.push({ property: name, permit: pick(["Fire safety certificate", "Occupancy permit"]), agency: "City Fire Dept", expiry: D(day(-pdays[0])), renewal_status: pdays[0] < 0 ? "Filed" : pdays[0] < 60 ? "In progress" : "Not due", owner: "Eng. Reyes", reason: pdays[0] < 0 ? "Inspector appointment not confirmed" : "", action_taken: pdays[0] < 60 ? "Application filed" : "" });
    out.pr.push({ property: name, permit: "Elevator licence", agency: "Building Official", expiry: D(day(-pdays[1])), renewal_status: "Not due", owner: "Eng. Reyes", reason: "", action_taken: "" });

    // opex: Jan..last complete month of this year, plus budget for the current month
    const curM = A.getMonth();
    for (let mi = 0; mi <= curM; mi++) {
      const m = A.getFullYear() + "-" + String(mi + 1).padStart(2, "0");
      const bud = 100000;
      const act = mi < curM ? Math.round(bud * (0.8 + b * 0.3 + (R() - 0.5) * 0.15)) : null;
      out.bg.push({ property: name, month: m, budget: String(bud), actual: act == null ? "" : String(act), reason: act && act > bud * 1.05 ? "Repeat repairs" : "", action_taken: act && act > bud * 1.05 ? "Non-urgent work orders on hold" : "" });
    }

    // uptime last month
    for (const sys of ["Power", "Water", "Elevator", "FDAS", "AFSS"]) {
      const pl = sys === "Elevator" ? 480 : 720;
      const hit = R() < b * 0.3 || (b >= 0.6 && sys === "Water");
      out.up.push({ property: name, system: sys, month: M(1), planned_hours: String(pl), downtime_hours: hit ? String(Math.round(2 + R() * 10)) : "0", interruptions: hit ? String(1 + Math.floor(R() * 2)) : "0", reason: hit ? sys + " outage" : "", action_taken: hit ? "Repaired and tested" : "" });
    }

    // projects
    out.pj.push({ project_id: "PRJ-" + name[0] + "1", project: pick(["Roof waterproofing", "Lobby renovation", "Chiller replacement", "LED retrofit"]), property: name, type: "CAPEX", description: "", owner: "Eng. Reyes", start_date: D(day(60)), finish_date: D(day(-60)), percent_complete: String(Math.round(50 - b * 45)), budget: "1200000", spent: String(Math.round(400000 + b * 300000)), status: "", next_milestone: "Vendor award", delay_reason: b > 0.5 ? "Award waits for approval above L1" : "", remarks: "", action_taken: b > 0.5 ? "Quote sent to GM" : "" });
    out.pj.push({ project_id: "PRJ-" + name[0] + "2", project: "Repainting common areas", property: name, type: "Project", description: "", owner: "Sup. Cruz", start_date: D(day(30)), finish_date: D(day(-30)), percent_complete: String(Math.round(48 - b * 10)), budget: "300000", spent: "120000", status: "", next_milestone: "Level 3 corridors", delay_reason: "", remarks: "", action_taken: "" });

    // incidents
    const nInc = Math.floor(b * 4);
    for (let i = 0; i < nInc; i++) {
      const dd = day(Math.floor(R() * 60));
      const sev = pick(["Minor", "Moderate", "Major"]);
      const closed = R() < 0.6;
      out.inc.push({ incident_id: "SF-" + inc++, property: name, date: D(dd), type: pick(["Injury", "Theft or intrusion", "Property damage", "Near miss"]), severity: sev, location: pick(["Lobby", "Parking", "Roof", "Pump room"]), description: "Reported by guard on duty", persons_involved: "", injured: "0", lost_time: "No", root_cause: "", action_taken: closed ? "Area secured" : "", reason: closed ? "" : "Investigation pending", target_date: D(new Date(dd.getTime() + 7 * 864e5)), closed_date: closed ? D(new Date(dd.getTime() + 2 * 864e5)) : "", owner: "Sup. Cruz" });
    }

    // contracts
    [["Elevator maintenance", "Vertex Lifts Inc.", -12], ["Security services", "SafeGuard Corp.", 24], ["Janitorial services", "CleanPro Services", 140]].forEach(([c, v, n], j) => {
      const nn = (n as number) + Math.round((1 - b) * 40);
      out.ct.push({ property: name, contract_no: "CT-" + name[0] + "0" + (j + 1), contract: c as string, vendor: v as string, contract_type: "Maintenance service", start_date: D(day(365 - nn)), end_date: D(day(-nn)), value: String(200000 + j * 150000), renewal_status: nn < 60 ? "In progress" : "Not started", owner: "Eng. Reyes", reason: "", action_taken: "" });
    });

    // condo cash
    for (let k = 3; k >= 1; k--) out.cc.push({ property: name, month: M(k), opening_cash: String(500000 + Math.round(R() * 100000)), inflows: String(150000), outflows: String(140000 + Math.round(R() * 30000)), remarks: "" });
  }
  return out;
}
