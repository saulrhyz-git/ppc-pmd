export const ROLES = ["General Manager", "Department Head", "Supervisor", "Admin/Engineer", "Technician", "Tenant"] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_NOTES: Record<Role, string> = {
  "General Manager": "Views all buildings; approves repairs and budgets above L2; sets targets.",
  "Department Head": "Views all buildings; assigns work; manages users and settings.",
  Supervisor: "Buildings in their section; verifies breakdowns; responds to tenant concerns.",
  "Admin/Engineer": "Assigned buildings; creates tickets and logs.",
  Technician: "Assigned buildings; sees work orders there and updates the ones assigned to them.",
  Tenant: "Raises concerns for their own building through the tenant portal. No dashboard access.",
};

export const TABS = [
  ["brief", "Needs Focus"],
  ["ov", "Section Overview"],
  ["wos", "Work Orders"],
  ["wo", "Concerns & Work Orders"],
  ["as", "Breakdowns & Assets"],
  ["bud", "Financial Performance"],
  ["pjm", "Project Monitoring"],
  ["pm", "Preventive Maintenance"],
  ["per", "Permits Compliance"],
  ["ct", "Contract Management"],
  ["sf", "Safety & Security"],
  ["data", "Data"],
  ["set", "Settings"],
] as const;
export type TabKey = (typeof TABS)[number][0];

/** 0 = hidden, 1 = view, 2 = view and edit. */
export type TabAccess = Partial<Record<TabKey, 0 | 1 | 2>>;

export function defaultTabs(role: Role): TabAccess {
  const o: TabAccess = {};
  for (const [k] of TABS) {
    if (role === "Tenant") o[k] = 0;
    else if (role === "Technician") o[k] = k === "wos" ? 2 : k === "set" ? 1 : 0;
    else if (k === "wos") o[k] = role === "General Manager" ? 1 : 2;
    else if (k === "set") o[k] = role === "Department Head" ? 2 : 1; // others see only "My password"
    else if (k === "data") o[k] = role === "General Manager" ? 0 : role === "Supervisor" ? 1 : 2;
    else o[k] = 1;
  }
  return o;
}

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  role: Role;
  section: string | null;
  properties: string[];
  canApprove: boolean;
  tabs: TabAccess;
}

/** Which buildings a user may see, given every building and its section. */
export function scopeFor(u: Pick<SessionUser, "role" | "section" | "properties">, all: { name: string; section: string | null }[]): string[] {
  if (u.role === "General Manager" || u.role === "Department Head") return all.map((p) => p.name);
  if (u.role === "Supervisor") return all.filter((p) => p.section && p.section === u.section).map((p) => p.name);
  return all.filter((p) => u.properties.includes(p.name)).map((p) => p.name);
}

export const canEditData = (u: SessionUser) => (u.tabs.data ?? 0) >= 2;
export const isStaff = (u: SessionUser) => u.role !== "Tenant";
