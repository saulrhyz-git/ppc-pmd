// Owner / tenant portal: shared types and rules used by the server (which enforces them)
// and the browser (which only uses them to explain things to the person).

/** How a portal account is related to a unit or leased space. */
export const PORTAL_RELATIONS = ["Owner", "Tenant", "Occupant", "Representative"] as const;
export type PortalRelation = (typeof PORTAL_RELATIONS)[number];

export const PORTAL_RELATION_NOTES: Record<PortalRelation, string> = {
  Owner: "Unit owner. Sees every request filed for the unit by default.",
  Tenant: "Leases the unit or space. Sees their own requests unless allowed to see all.",
  Occupant: "Lives or works in the unit (family member, staff of the tenant).",
  Representative: "Acts for the owner or tenant, for example a leasing agent or company admin.",
};

/** How urgent the person says the problem is. Staff decide the real work order priority. */
export const PORTAL_URGENCY = ["Normal", "Urgent"] as const;
export type PortalUrgency = (typeof PORTAL_URGENCY)[number];

/** Request statuses as the person sees them (the staff concern statuses). */
export const PORTAL_REQUEST_STATUS = ["Sent", "Received", "In progress", "Resolved", "Closed"] as const;

export const PORTAL_PASSWORD_MIN = 12;
/** bcrypt only reads the first 72 bytes. */
export const PORTAL_PASSWORD_MAX_BYTES = 72;

const COMMON = new Set([
  "password1234", "password12345", "123456789012", "1234567890123", "qwertyuiop12", "qwertyuiopas", "iloveyou1234", "welcome12345",
  "changeme1234", "changeme123!", "letmein12345", "administrator", "passw0rd1234", "p@ssw0rd1234", "abcdefghijkl", "aaaaaaaaaaaa",
]);

/** Returns why a new password is not acceptable, or null when it is. */
export function passwordProblem(pw: string, email = "", name = ""): string | null {
  if (pw.length < PORTAL_PASSWORD_MIN) return `Use at least ${PORTAL_PASSWORD_MIN} characters`;
  if (new TextEncoder().encode(pw).length > PORTAL_PASSWORD_MAX_BYTES) return "Use at most 72 bytes (about 70 characters)";
  const lower = pw.toLowerCase();
  if (COMMON.has(lower)) return "That password is too common";
  if (new Set(lower).size < 5) return "Use more different characters";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && lower.includes(local)) return "Do not include your email address";
  for (const part of name.toLowerCase().split(/\s+/)) if (part.length >= 4 && lower.includes(part)) return "Do not include your name";
  if (/^(.)\1+$/.test(pw) || /^(0123456789|1234567890|abcdefghij)/.test(lower)) return "That password is too easy to guess";
  return null;
}

export interface PortalUnitDTO {
  accessId: string;
  unitId: string;
  code: string;
  kind: string;
  floor: string;
  building: string;
  buildingKind: string;
  relation: PortalRelation;
  canRequest: boolean;
  seeAllRequests: boolean;
  endsOn: string | null;
  openRequests: number;
}

export interface PortalMeDTO {
  id: string;
  email: string;
  name: string;
  phone: string;
  mfaEnabled: boolean;
  mfaRequired: boolean;
  units: PortalUnitDTO[];
}

export interface PortalAttachmentDTO {
  id: string;
  filename: string;
  mime: string;
  size: number;
}

export interface PortalUpdateDTO {
  id: string;
  kind: "followup" | "response" | "status";
  message: string;
  /** "You", another named person on the account's units, or "Property management". */
  authorName: string;
  mine: boolean;
  createdAt: string;
  attachments: PortalAttachmentDTO[];
}

export interface PortalWorkOrderDTO {
  ticket: string;
  title: string;
  status: string;
  targetDate: string;
  completedAt: string | null;
}

export interface PortalRequestDTO {
  id: string;
  controlNo: string;
  unitId: string | null;
  unitCode: string;
  building: string;
  trade: string;
  location: string;
  concern: string;
  urgency: PortalUrgency;
  status: string;
  createdAt: string;
  filedBy: string;
  mine: boolean;
  updates: PortalUpdateDTO[];
  attachments: PortalAttachmentDTO[];
  workOrders: PortalWorkOrderDTO[];
}

export interface PortalSessionDTO {
  id: string;
  current: boolean;
  ip: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
}

// ----- staff side -----

export interface PortalAccessDTO {
  id: string;
  unitId: string;
  unitCode: string;
  building: string;
  relation: PortalRelation;
  canRequest: boolean;
  seeAllRequests: boolean;
  endsOn: string | null;
  revokedAt: string | null;
  grantedByName: string | null;
  createdAt: string;
}

export interface PortalAccountAdminDTO {
  id: string;
  email: string;
  name: string;
  phone: string;
  /** Invited = has not set a password yet. */
  state: "Invited" | "Active" | "Disabled" | "Locked";
  mfaEnabled: boolean;
  lastLoginAt: string | null;
  createdAt: string;
  access: PortalAccessDTO[];
}

export interface PortalLinkDTO {
  /** The full link to send to the person. Shown once; only its hash is stored. */
  url: string;
  expiresAt: string;
}
