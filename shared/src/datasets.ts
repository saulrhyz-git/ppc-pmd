// Dataset (register / log) definitions. These mirror the Excel templates used by the
// prototype's Data screen. Every row is stored as JSON in Postgres and validated here,
// so the server and the browser apply exactly the same rules.

export type ColType = "text" | "longtext" | "date" | "datetime" | "month" | "number" | "yesno" | "enum";

export interface Column {
  key: string;
  label: string;
  type: ColType;
  required?: boolean;
  options?: readonly string[];
}

export interface DatasetDef {
  key: DatasetKey;
  label: string;
  description: string;
  columns: Column[];
}

export const UPTIME_SYSTEMS = ["Power", "Water", "Elevator", "FDAS", "AFSS"] as const;
export const SEVERITIES = ["Minor", "Moderate", "Major", "Critical"] as const;
export const INCIDENT_TYPES = ["Injury", "Fire or smoke", "Theft or intrusion", "Property damage", "Security breach", "Near miss", "Other"] as const;
export const TRADES = ["Elevator", "Power / generator", "Water / pumps", "HVAC", "Fire protection (FDAS / AFSS)", "Electrical", "Plumbing", "Security", "Building / civil", "Other"] as const;
export const ACTIVITY_TYPES = ["Reactive", "Preventive", "Requests/Improvement"] as const;
export const WO_STATUS = ["Open", "Closed"] as const;
export const PROJECT_STATUS = ["", "Completed", "On hold"] as const;

export type DatasetKey = "cs" | "m" | "b" | "pm" | "pr" | "bg" | "pj" | "inc" | "up" | "ar" | "ct" | "cc" | "tr";

const t = (key: string, label: string, required = false): Column => ({ key, label, type: "text", required });
const lt = (key: string, label: string): Column => ({ key, label, type: "longtext" });
const d = (key: string, label: string, required = false): Column => ({ key, label, type: "date", required });
const dt = (key: string, label: string, required = false): Column => ({ key, label, type: "datetime", required });
const n = (key: string, label: string, required = false): Column => ({ key, label, type: "number", required });
const mo = (key: string, label: string): Column => ({ key, label, type: "month", required: true });
const yn = (key: string, label: string): Column => ({ key, label, type: "yesno" });
const en = (key: string, label: string, options: readonly string[], required = false): Column => ({ key, label, type: "enum", options, required });
const prop: Column = { key: "property", label: "Building", type: "text", required: true };
const reason = lt("reason", "Reason");
const action = lt("action_taken", "Action taken");

export const DATASETS: DatasetDef[] = [
  {
    key: "cs", label: "Concern slips",
    description: "Every client concern is logged on a concern slip. A slip is closed only when the concern is actually resolved.",
    columns: [t("control_no", "Control no.", true), prop, lt("concern", "Concern"), en("trade", "Trade", TRADES), t("requested_by", "Requested by"), t("company", "Company"), t("received_by", "Received by"), dt("date_received", "Date received", true), t("responded_by", "Responded by"), dt("date_responded", "Date responded"), action, dt("resolution_date", "Resolution established"), dt("date_closed", "Date closed"), t("work_order", "Work order"), t("tenant_account", "Tenant account"), lt("tenant_update", "Update to tenant")],
  },
  {
    key: "m", label: "Work orders (master log)",
    description: "One row per work order. Open work orders drive the open tickets, aged and past-target figures.",
    columns: [t("ticket", "Ticket", true), prop, lt("description", "Description"), en("activity_type", "Activity type", ACTIVITY_TYPES), t("location", "Location"), t("asset", "Asset"), d("date_opened", "Date opened", true), t("reported_by", "Reported by"), t("tenant", "Tenant / company"), lt("root_cause", "Root cause"), lt("remarks", "Remarks"), n("est_cost", "Est. cost"), yn("chargeable_to_tenant", "Chargeable to tenant"), d("target_date", "Target date", true), en("status", "Status", WO_STATUS, true), lt("last_update", "Last update"), d("date_closed", "Date closed"), t("owner", "Owner"), reason, action],
  },
  {
    key: "b", label: "Breakdown log",
    description: "Breakdowns of equipment. Leave Restored blank while the asset is still down.",
    columns: [prop, t("asset", "Asset", true), dt("start", "Start", true), dt("restored", "Restored"), t("cause", "Cause"), t("ticket", "Ticket"), action, lt("delay_reason", "Reason for delay")],
  },
  {
    key: "pm", label: "PM sheet",
    description: "Preventive maintenance tasks with due and done dates.",
    columns: [prop, t("task", "Task", true), t("asset", "Asset"), d("due_date", "Due date", true), d("done_date", "Done date"), yn("critical", "Critical asset"), t("owner", "Owner"), reason, action, n("cost", "Cost")],
  },
  {
    key: "pr", label: "Permit register",
    description: "Permits and certificates with expiry dates.",
    columns: [prop, t("permit", "Permit", true), t("agency", "Agency"), d("expiry", "Expiry", true), t("renewal_status", "Renewal status"), t("owner", "Owner"), reason, action],
  },
  {
    key: "bg", label: "Operating expenses (monthly)",
    description: "Budget and actual per building and month, from the accounting report.",
    columns: [prop, mo("month", "Month"), n("budget", "Budget", true), n("actual", "Actual"), reason, action],
  },
  {
    key: "pj", label: "Projects register (CAPEX and projects)",
    description: "CAPEX and projects with schedule, budget and progress.",
    columns: [t("project_id", "Project ID"), t("project", "Project", true), prop, en("type", "Type", ["CAPEX", "Project"]), lt("description", "Description"), t("owner", "Owner"), d("start_date", "Start date", true), d("finish_date", "Finish date", true), n("percent_complete", "% complete", true), n("budget", "Budget"), n("spent", "Spent"), en("status", "Status", PROJECT_STATUS), t("next_milestone", "Next milestone"), lt("delay_reason", "Reason for delay"), lt("remarks", "Remarks"), action],
  },
  {
    key: "inc", label: "Safety incident log",
    description: "Incidents and accidents.",
    columns: [t("incident_id", "Incident ID", true), prop, d("date", "Date", true), en("type", "Type", INCIDENT_TYPES), en("severity", "Severity", SEVERITIES, true), t("location", "Location"), lt("description", "What happened"), t("persons_involved", "Persons involved"), n("injured", "Injured"), yn("lost_time", "Lost time"), lt("root_cause", "Root cause"), action, reason, d("target_date", "Target date"), d("closed_date", "Closed date"), t("owner", "Owner")],
  },
  {
    key: "up", label: "Critical systems uptime",
    description: "Monthly planned hours and unplanned downtime for Power, Water, Elevator, FDAS and AFSS.",
    columns: [prop, en("system", "System", UPTIME_SYSTEMS, true), mo("month", "Month"), n("planned_hours", "Planned hours", true), n("downtime_hours", "Unplanned downtime (h)"), n("interruptions", "Interruptions"), reason, action],
  },
  {
    key: "ar", label: "Asset register",
    description: "Equipment per building.",
    columns: [prop, t("asset_tag", "Asset tag"), t("asset", "Asset", true), t("category", "Category"), t("location", "Location"), yn("critical", "Critical"), t("status", "Status")],
  },
  {
    key: "ct", label: "Contract register",
    description: "Service and supply contracts.",
    columns: [prop, t("contract_no", "Contract no."), t("contract", "Contract", true), t("vendor", "Vendor"), t("contract_type", "Type"), d("start_date", "Start date"), d("end_date", "End date", true), n("value", "Value"), t("renewal_status", "Renewal status"), t("owner", "Owner"), reason, action],
  },
  {
    key: "cc", label: "Condo Corp cash position (monthly)",
    description: "Opening cash, inflows and outflows per month.",
    columns: [prop, mo("month", "Month"), n("opening_cash", "Opening cash", true), n("inflows", "Inflows"), n("outflows", "Outflows"), lt("remarks", "Remarks")],
  },
  {
    key: "tr", label: "Tenant register",
    description: "Tenants per building, linked to tenant portal accounts.",
    columns: [prop, t("tenant_id", "Tenant ID / code"), t("tenant", "Tenant (company) name", true), t("unit", "Unit"), t("contact_person", "Contact person"), t("contact", "Contact"), t("portal_account", "Portal account (email)"), t("status", "Status")],
  },
];

export const DATASET_BY_KEY: Record<DatasetKey, DatasetDef> = Object.fromEntries(DATASETS.map((x) => [x.key, x])) as Record<DatasetKey, DatasetDef>;

export type Row = Record<string, string>;

// ---------- parsing helpers (shared with the KPI engine) ----------
export function parseDate(s: string | undefined | null): Date | null {
  if (!s) return null;
  const v = String(s).trim();
  if (!v) return null;
  const x = new Date(v.length === 10 ? v + "T00:00" : v.replace(" ", "T"));
  return isNaN(x.getTime()) ? null : x;
}
const MONTH_RE = /^\d{4}-(0[1-9]|1[0-2])$/;
const num = (v: string | undefined) => (v == null || String(v).trim() === "" ? null : Number(v));

/** Returns an error message, or null when the row is valid. Rules follow the prototype. */
export function validateRow(key: DatasetKey, r: Row): string | null {
  const def = DATASET_BY_KEY[key];
  if (!def) return "unknown dataset";
  for (const c of def.columns) {
    const v = (r[c.key] ?? "").toString().trim();
    if (c.required && !v) return `${c.label} is required`;
    if (!v) continue;
    if ((c.type === "date" || c.type === "datetime") && !parseDate(v)) return `${c.label} is not a valid date`;
    if (c.type === "month" && !MONTH_RE.test(v)) return `${c.label} must look like 2026-10`;
    if (c.type === "number" && !isFinite(Number(v))) return `${c.label} must be a number`;
    if (c.type === "enum" && c.options && !c.options.some((o) => o.toLowerCase() === v.toLowerCase())) return `${c.label} must be one of: ${c.options.filter(Boolean).join(", ")}`;
  }
  const D = (k: string) => parseDate(r[k]);
  switch (key) {
    case "m": {
      if ((r.status || "").toLowerCase() === "closed" && !D("date_closed")) return "a closed work order needs the date closed";
      break;
    }
    case "b": {
      const s = D("start"), e = D("restored");
      if (r.restored && (!e || (s && e < s))) return "restored is invalid or before start";
      break;
    }
    case "pj": {
      const s = D("start_date"), f = D("finish_date"), pc = num(r.percent_complete);
      if (s && f && f <= s) return "finish date must be after the start date";
      if (pc == null || pc < 0 || pc > 100) return "% complete must be 0 to 100";
      break;
    }
    case "inc": {
      const a = D("date"), c = D("closed_date");
      if (a && c && c < a) return "closed date is before the incident date";
      break;
    }
    case "up": {
      const pl = num(r.planned_hours) ?? 0, dt0 = num(r.downtime_hours) ?? 0;
      if (!(pl > 0)) return "planned operating hours must be more than 0";
      if (dt0 < 0 || dt0 > pl) return "unplanned downtime hours must be between 0 and the planned hours";
      break;
    }
    case "bg": {
      if ((num(r.budget) ?? -1) < 0) return "budget cannot be negative";
      break;
    }
    case "cs": {
      const rc = D("date_received"), rs = D("date_responded"), cl = D("date_closed"), re = D("resolution_date");
      if (rc && rs && rs < rc) return "date responded is before date received";
      if (rc && cl && cl < rc) return "date closed is before date received";
      if (rc && re && re < rc) return "resolution established is before date received";
      if (re && cl && cl < re) return "date closed is before the resolution established";
      if (r.date_closed && (r.work_order || "").trim()) return "a slip with a work order closes when its work order closes, not on the slip";
      if (r.date_closed && !(r.action_taken || "").trim()) return "closing a slip needs the action taken";
      break;
    }
  }
  return null;
}

/** Keep only known columns, trimmed, and normalise enum casing. */
export function cleanRow(key: DatasetKey, r: Record<string, unknown>): Row {
  const out: Row = {};
  for (const c of DATASET_BY_KEY[key].columns) {
    let v = r[c.key] == null ? "" : String(r[c.key]).trim();
    if (c.type === "enum" && c.options && v) v = c.options.find((o) => o.toLowerCase() === v.toLowerCase()) ?? v;
    if (c.type === "yesno" && v) v = /^y/i.test(v) ? "Yes" : /^n/i.test(v) ? "No" : v;
    out[c.key] = v;
  }
  return out;
}

// ---------- CSV ----------
export function parseCsv(text: string): Row[] {
  const rows: string[][] = [];
  let w: string[] = [], c = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const h = text[i];
    if (q) {
      if (h === '"') { if (text[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += h;
    } else if (h === '"') q = true;
    else if (h === ",") { w.push(c); c = ""; }
    else if (h === "\n" || h === "\r") { if (h === "\r" && text[i + 1] === "\n") i++; w.push(c); rows.push(w); w = []; c = ""; }
    else c += h;
  }
  w.push(c); rows.push(w);
  const head = (rows.shift() || []).map((x) => x.trim().toLowerCase());
  return rows.filter((x) => x.some((y) => y.trim())).map((x) => Object.fromEntries(head.map((k, i) => [k, (x[i] ?? "").trim()])));
}

export function toCsv(key: DatasetKey, rows: Row[]): string {
  const cols = DATASET_BY_KEY[key].columns.map((c) => c.key);
  const esc = (v: string) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return [cols.join(","), ...rows.map((r) => cols.map((k) => esc(r[k] ?? "")).join(","))].join("\n") + "\n";
}
