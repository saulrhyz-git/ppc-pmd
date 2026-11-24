// Work order lifecycle, shared by the server (which enforces it) and the browser
// (which only offers the buttons the user is allowed to press).
import { ACTIVITY_TYPES, TRADES } from "./datasets.ts";
import type { Role } from "./roles.ts";

export const WO_STATUSES = ["New", "Assigned", "In Progress", "On Hold", "Completed", "Closed", "Cancelled"] as const;
export type WoStatus = (typeof WO_STATUSES)[number];

export const WO_PRIORITIES = ["Low", "Medium", "High", "Urgent"] as const;
export type WoPriority = (typeof WO_PRIORITIES)[number];

export const WO_STATUS_NOTES: Record<WoStatus, string> = {
  New: "Logged, nobody assigned yet.",
  Assigned: "Assigned to one or more people; work not started.",
  "In Progress": "Work has started.",
  "On Hold": "Paused, for example waiting for parts, a vendor or access. A reason is required.",
  Completed: "Technician has finished the work. Waiting for a supervisor to verify.",
  Closed: "Verified and closed by a supervisor.",
  Cancelled: "Will not be done (duplicate, not needed). A reason is required.",
};

/** Statuses counted as finished work for the dashboards. */
export const WO_DONE: readonly WoStatus[] = ["Completed", "Closed"];
/** Statuses still needing work. */
export const WO_OPEN: readonly WoStatus[] = ["New", "Assigned", "In Progress", "On Hold"];

/** Every move between statuses that exists at all. */
export const WO_TRANSITIONS: Record<WoStatus, readonly WoStatus[]> = {
  New: ["Assigned", "In Progress", "Cancelled"],
  Assigned: ["In Progress", "On Hold", "Cancelled"],
  "In Progress": ["On Hold", "Completed", "Cancelled"],
  "On Hold": ["In Progress", "Cancelled"],
  Completed: ["Closed", "In Progress"],
  Closed: ["In Progress"],
  Cancelled: ["New"],
};

/** Moves a technician may make on a work order assigned to them. */
const TECH_MOVES: Partial<Record<WoStatus, readonly WoStatus[]>> = {
  Assigned: ["In Progress", "On Hold"],
  "In Progress": ["On Hold", "Completed"],
  "On Hold": ["In Progress"],
};

/** Moves that need a note explaining why. */
export const WO_NEEDS_NOTE: Partial<Record<WoStatus, string>> = {
  "On Hold": "Say why the work is on hold",
  Completed: "Describe the work done",
  Cancelled: "Say why it is cancelled",
};

/** Roles that assign, verify, close and cancel work orders. */
export const WO_MANAGER_ROLES: readonly Role[] = ["General Manager", "Department Head", "Supervisor", "Admin/Engineer"];
export const isWoManager = (role: Role) => WO_MANAGER_ROLES.includes(role);
/** Roles that can be assigned work orders. */
export const WO_ASSIGNABLE_ROLES: readonly Role[] = ["Technician", "Supervisor", "Admin/Engineer", "Department Head"];

export interface WoActor { id: string; role: Role }

/** The statuses this user may move this work order to. Edit access (tab level 2) is checked separately. */
export function allowedMoves(u: WoActor, wo: { status: WoStatus; assigneeIds: string[] }): WoStatus[] {
  const all = WO_TRANSITIONS[wo.status] ?? [];
  if (isWoManager(u.role)) return [...all];
  if (u.role === "Technician" && wo.assigneeIds.includes(u.id)) return all.filter((s) => (TECH_MOVES[wo.status] ?? []).includes(s));
  return [];
}

export const canAssign = (u: WoActor) => isWoManager(u.role);
/** Managers edit any detail; technicians edit the work notes of work orders assigned to them. */
export const canEditDetails = (u: WoActor) => isWoManager(u.role);
export const canEditWorkNotes = (u: WoActor, wo: { assigneeIds: string[] }) => isWoManager(u.role) || wo.assigneeIds.includes(u.id);

export interface WoUserRef { id: string; name: string; role: string }

export interface WoEventDTO {
  id: string;
  kind: "created" | "status" | "assign" | "comment" | "edit";
  fromStatus: string | null;
  toStatus: string | null;
  message: string;
  authorName: string;
  authorRole: string;
  createdAt: string;
}

/** A photo attached to a work order (before / after shots taken on site). */
export interface WoPhotoDTO {
  id: string;
  filename: string;
  mime: string;
  size: number;
  byId: string;
  byName: string;
  createdAt: string;
}

export interface WorkOrderDTO {
  id: string;
  ticket: string;
  property: string;
  title: string;
  description: string;
  activityType: (typeof ACTIVITY_TYPES)[number];
  trade: string;
  priority: WoPriority;
  status: WoStatus;
  location: string;
  asset: string;
  reportedBy: string;
  tenant: string;
  rootCause: string;
  remarks: string;
  estCost: number | null;
  chargeable: boolean;
  dateOpened: string; // YYYY-MM-DD
  targetDate: string; // YYYY-MM-DD
  startedAt: string | null;
  completedAt: string | null;
  closedAt: string | null;
  holdReason: string;
  reason: string;
  actionTaken: string;
  ownerName: string;
  concernId: string | null;
  /** Linked unit/space and equipment records (the free-text location/asset fields stay for older work orders). */
  unitId: string | null;
  unitCode: string | null;
  assetId: string | null;
  assetTag: string | null;
  assetName: string | null;
  assignees: WoUserRef[];
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
  events?: WoEventDTO[];
  /** Photos, on the single work order response only. */
  photos?: WoPhotoDTO[];
}

export const WO_TRADES = TRADES;

/** Converts a work order into the column shape of the legacy "m" register, so the KPI engine keeps working unchanged. */
export function woToLegacyRow(w: Pick<WorkOrderDTO, "ticket" | "property" | "description" | "title" | "activityType" | "location" | "asset" | "dateOpened" | "reportedBy" | "tenant" | "rootCause" | "remarks" | "estCost" | "chargeable" | "targetDate" | "status" | "completedAt" | "closedAt" | "ownerName" | "reason" | "actionTaken" | "holdReason"> & { assignees: { name: string }[] }): Record<string, string> {
  const done = WO_DONE.includes(w.status);
  const closedOn = (w.completedAt || w.closedAt || "").slice(0, 10);
  return {
    ticket: w.ticket,
    property: w.property,
    description: w.description || w.title,
    activity_type: w.activityType,
    location: w.location,
    asset: w.asset,
    date_opened: w.dateOpened,
    reported_by: w.reportedBy,
    tenant: w.tenant,
    root_cause: w.rootCause,
    remarks: w.remarks,
    est_cost: w.estCost == null ? "" : String(w.estCost),
    chargeable_to_tenant: w.chargeable ? "Yes" : "No",
    target_date: w.targetDate,
    status: done ? "Closed" : "Open",
    last_update: w.status,
    date_closed: done ? closedOn : "",
    owner: w.assignees.length ? w.assignees.map((a) => a.name).join(", ") : w.ownerName,
    reason: w.reason || w.holdReason,
    action_taken: w.actionTaken,
  };
}

const validDate = (v: string | undefined) => {
  const s = (v || "").slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) && !isNaN(new Date(s + "T00:00:00Z").getTime()) ? s : "";
};

/** Fields of a new work order built from a row of the old "m" register (CSV import, sample data). */
export function legacyRowToWo(r: Record<string, string>, today: string) {
  const closed = (r.status || "").trim().toLowerCase() === "closed";
  const opened = validDate(r.date_opened) || today;
  const closedOn = validDate(r.date_closed) || today;
  const cost = Number(String(r.est_cost ?? "").replace(/,/g, ""));
  const activity = (ACTIVITY_TYPES as readonly string[]).includes(r.activity_type) ? (r.activity_type as WorkOrderDTO["activityType"]) : "Reactive";
  return {
    ticket: (r.ticket || "").trim(),
    property: r.property,
    title: (r.description || "").trim().slice(0, 120) || (r.asset ? r.asset + " work order" : "Work order"),
    description: r.description || "",
    activityType: activity,
    status: (closed ? "Closed" : "New") as WoStatus,
    location: r.location || "",
    asset: r.asset || "",
    reportedBy: r.reported_by || "",
    tenant: r.tenant || "",
    rootCause: r.root_cause || "",
    remarks: [r.remarks, r.last_update].filter(Boolean).join("\n"),
    estCost: r.est_cost && isFinite(cost) ? cost : null,
    chargeable: /^y/i.test(r.chargeable_to_tenant || ""),
    dateOpened: opened,
    targetDate: validDate(r.target_date) || opened,
    completedAt: closed ? closedOn : null,
    closedAt: closed ? closedOn : null,
    reason: r.reason || "",
    actionTaken: r.action_taken || "",
    ownerName: r.owner || "",
  };
}
