// Buildings, units/spaces, equipment and meters: shared lists, record shapes and who may change what.
import type { Role } from "./roles.ts";

export const BUILDING_KINDS = ["Condominium", "Commercial", "Mixed"] as const;
export type BuildingKind = (typeof BUILDING_KINDS)[number];

export const UNIT_KINDS = ["Condominium unit", "Commercial space", "Common area", "Parking", "Storage", "Other"] as const;
export type UnitKind = (typeof UNIT_KINDS)[number];

export const UNIT_OCCUPANCY = ["Vacant", "Owner-occupied", "Leased"] as const;
export type UnitOccupancy = (typeof UNIT_OCCUPANCY)[number];

export const UNIT_STATUSES = ["Active", "Inactive"] as const;

export const ASSET_CATEGORIES = [
  "HVAC", "Chiller", "Cooling tower", "AHU / FCU", "Pump", "Elevator / Escalator", "Generator", "Transformer", "Switchgear / Panel",
  "UPS", "Fire protection", "Fire alarm", "CCTV / Security", "Plumbing", "Water tank", "Lighting", "BMS / Controls", "Civil / Structural", "Meter", "Other",
] as const;

export const ASSET_STATUSES = ["In service", "Down", "Standby", "Retired"] as const;
export type AssetStatus = (typeof ASSET_STATUSES)[number];

export const METER_CLASSES = ["Tenant", "Common Area", "Utility Main"] as const;
export type MeterClass = (typeof METER_CLASSES)[number];
export const METER_CLASS_NOTES: Record<MeterClass, string> = {
  Tenant: "Measures one unit or leased space. Billed, ranked and reported to the occupant.",
  "Common Area": "Measures shared loads (lobby, corridors, building systems). Not billed to a tenant.",
  "Utility Main": "The utility's own meter at the service entrance. Used to check that sub-meters add up (energy balance).",
};

export const METER_UTILITIES = ["Power", "Water"] as const;
export type MeterUtility = (typeof METER_UTILITIES)[number];
export const UTILITY_UNIT: Record<MeterUtility, string> = { Power: "kWh", Water: "m³" };

export const METER_EVENT_TYPES = ["Replacement", "Rollover", "Maintenance", "Calibration", "Reconfiguration"] as const;
export type MeterEventType = (typeof METER_EVENT_TYPES)[number];
/** Events that change the register and therefore need the old final reading and the new start reading. */
export const REGISTER_EVENTS: readonly MeterEventType[] = ["Replacement", "Rollover"];

export const READING_METHODS = ["Manual", "Photo", "Import"] as const;

// ---------- permissions ----------
// Tab "ast" (Assets) controls buildings, units, equipment and the meter list.
// Tab "mtr" (Meter readings) controls entering readings. Technicians enter readings
// but do not change the meter list or void other people's readings.

/** Roles that may void a reading or log a meter event (on top of edit access to the Meter readings tab). */
export const METER_MANAGER_ROLES: readonly Role[] = ["General Manager", "Department Head", "Supervisor", "Admin/Engineer"];
export const isMeterManager = (role: Role) => METER_MANAGER_ROLES.includes(role);

// ---------- record shapes sent to the browser ----------
export interface BuildingDTO {
  id: string;
  name: string;
  section: string | null;
  kind: BuildingKind;
  code: string;
  address: string;
  floors: number | null;
  notes: string;
  unitCount: number;
  assetCount: number;
  meterCount: number;
}

export interface UnitDTO {
  id: string;
  propertyId: string;
  property: string;
  code: string;
  kind: UnitKind;
  floor: string;
  areaSqm: number | null;
  occupancy: UnitOccupancy;
  ownerName: string;
  tenantName: string;
  status: string;
  notes: string;
  assetCount: number;
  meterCount: number;
  openWorkOrders: number;
}

export interface AssetDTO {
  id: string;
  tag: string;
  propertyId: string;
  property: string;
  unitId: string | null;
  unitCode: string | null;
  parentId: string | null;
  parentTag: string | null;
  name: string;
  category: string;
  trade: string;
  location: string;
  make: string;
  model: string;
  serial: string;
  installDate: string | null;
  warrantyUntil: string | null;
  critical: boolean;
  status: AssetStatus;
  notes: string;
  openWorkOrders: number;
}

export interface MeterDTO {
  id: string;
  code: string;
  propertyId: string;
  property: string;
  unitId: string | null;
  unitCode: string | null;
  occupant: string;
  assetId: string | null;
  meterClass: MeterClass;
  utility: MeterUtility;
  unitOfMeasure: string;
  serial: string;
  brand: string;
  location: string;
  ctRatio: string;
  multiplier: number;
  rolloverAt: number | null;
  expectedDaily: boolean;
  activeFrom: string;
  activeTo: string | null;
  notes: string;
}

export interface MeterReadingDTO {
  id: string;
  meterId: string;
  date: string;
  readAt: string;
  value: number;
  method: string;
  note: string;
  takenBy: string | null;
  voided: boolean;
  voidReason: string;
  voidedBy: string | null;
  createdAt: string;
}

export interface MeterEventDTO {
  id: string;
  meterId: string;
  date: string;
  type: MeterEventType;
  prevReading: number | null;
  newReading: number | null;
  notes: string;
  by: string | null;
}

/** "GF-05 · Tenant name" style label for a unit. */
export const unitLabel = (u: { code: string; tenantName?: string; ownerName?: string }) => {
  const who = u.tenantName || u.ownerName;
  return who ? `${u.code} · ${who}` : u.code;
};
