// Buildings, units/spaces and equipment as linked records.
import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  ASSET_STATUSES, BUILDING_KINDS, UNIT_KINDS, UNIT_OCCUPANCY, UNIT_STATUSES, WO_OPEN, isMeterManager,
  type AssetDTO, type BuildingDTO, type UnitDTO,
} from "@pmd/shared";
import { prisma, allProperties, audit, scopeOf } from "../db.ts";
import { HttpError, requireTab, staffOnly } from "../auth.ts";

export const assetsRouter = Router();
assetsRouter.use(staffOnly);
const canRead = requireTab("ast", 1);
const canWrite = requireTab("ast", 2);

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-01-31");
const OPEN = [...WO_OPEN, "Completed"];

/** The buildings this user may see, as { id, name }. */
export async function scopedProperties(req: Request) {
  const names = new Set(await scopeOf(req.user!));
  return (await allProperties()).filter((p) => names.has(p.name));
}
/** Throws unless the building id is in the user's scope. Returns its name. */
export async function checkProperty(req: Request, propertyId: string) {
  const p = (await scopedProperties(req)).find((x) => x.id === propertyId);
  if (!p) throw new HttpError(403, "Not your building");
  return p;
}
/** Resolves ?property= given either as an id or a name. */
async function propertyFilter(req: Request): Promise<string[]> {
  const props = await scopedProperties(req);
  const q = typeof req.query.property === "string" ? req.query.property : "";
  if (!q) return props.map((p) => p.id);
  const p = props.find((x) => x.id === q || x.name === q);
  if (!p) throw new HttpError(403, "Not your building");
  return [p.id];
}
const managerOnly = (req: Request) => {
  if (!isMeterManager(req.user!.role)) throw new HttpError(403, "Only supervisors and engineers can change asset records");
};

// ---------- lookup (for work order forms) ----------
assetsRouter.get("/lookup", async (req, res, next) => {
  try {
    const ids = await propertyFilter(req);
    const [units, assets] = await Promise.all([
      prisma.unit.findMany({ where: { propertyId: { in: ids }, status: "Active" }, select: { id: true, code: true, propertyId: true, tenantName: true, ownerName: true, kind: true, floor: true }, orderBy: { code: "asc" } }),
      prisma.asset.findMany({ where: { propertyId: { in: ids }, status: { not: "Retired" } }, select: { id: true, tag: true, name: true, propertyId: true, unitId: true, location: true, category: true }, orderBy: { tag: "asc" } }),
    ]);
    res.json({ units, assets });
  } catch (e) {
    next(e);
  }
});

// ---------- buildings ----------
assetsRouter.get("/buildings", canRead, async (req, res, next) => {
  try {
    const props = await scopedProperties(req);
    const rows = await prisma.property.findMany({
      where: { id: { in: props.map((p) => p.id) } },
      include: { section: true, _count: { select: { units: true, assets: true, meters: true } } },
    });
    const byId = new Map(rows.map((r) => [r.id, r]));
    res.json(props.map((p): BuildingDTO => {
      const r = byId.get(p.id)!;
      return { id: r.id, name: r.name, section: r.section?.name ?? null, kind: r.kind as BuildingDTO["kind"], code: r.code, address: r.address, floors: r.floors, notes: r.notes, unitCount: r._count.units, assetCount: r._count.assets, meterCount: r._count.meters };
    }));
  } catch (e) {
    next(e);
  }
});

assetsRouter.patch("/buildings/:id", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    await checkProperty(req, req.params.id);
    const b = z.object({
      kind: z.enum(BUILDING_KINDS), code: z.string().trim().max(20), address: z.string().max(300), floors: z.number().int().min(0).max(300).nullable(), notes: z.string().max(4000),
    }).partial().strict().parse(req.body);
    await prisma.property.update({ where: { id: req.params.id }, data: b });
    await audit(req.user!, "building.update", { id: req.params.id, fields: Object.keys(b) });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- units / spaces ----------
const unitInclude = { property: { select: { name: true } }, _count: { select: { assets: true, meters: true } } };
type UnitRow = Prisma.UnitGetPayload<{ include: typeof unitInclude }>;
async function openWoCounts(field: "unitId" | "assetId", ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const g = await prisma.workOrder.groupBy({ by: [field], where: { [field]: { in: ids }, status: { in: OPEN } }, _count: { _all: true } });
  return new Map(g.map((x) => [x[field] as string, x._count._all]));
}
const unitDTO = (u: UnitRow, open: Map<string, number>): UnitDTO => ({
  id: u.id, propertyId: u.propertyId, property: u.property.name, code: u.code, kind: u.kind as UnitDTO["kind"], floor: u.floor,
  areaSqm: u.areaSqm == null ? null : Number(u.areaSqm), occupancy: u.occupancy as UnitDTO["occupancy"], ownerName: u.ownerName, tenantName: u.tenantName,
  status: u.status, notes: u.notes, assetCount: u._count.assets, meterCount: u._count.meters, openWorkOrders: open.get(u.id) ?? 0,
});

const unitFields = {
  code: z.string().trim().min(1, "Give the unit a code, e.g. 12-03").max(40),
  kind: z.enum(UNIT_KINDS),
  floor: z.string().trim().max(20),
  areaSqm: z.number().nonnegative().max(1e7).nullable(),
  occupancy: z.enum(UNIT_OCCUPANCY),
  ownerName: z.string().trim().max(200),
  tenantName: z.string().trim().max(200),
  status: z.enum(UNIT_STATUSES),
  notes: z.string().max(4000),
};
const unitCreate = z.object({
  propertyId: z.string().min(1), code: unitFields.code, kind: unitFields.kind.default("Commercial space"), floor: unitFields.floor.default(""),
  areaSqm: unitFields.areaSqm.default(null), occupancy: unitFields.occupancy.default("Vacant"), ownerName: unitFields.ownerName.default(""),
  tenantName: unitFields.tenantName.default(""), status: unitFields.status.default("Active"), notes: unitFields.notes.default(""),
});

assetsRouter.get("/units", canRead, async (req, res, next) => {
  try {
    const ids = await propertyFilter(req);
    const list = await prisma.unit.findMany({ where: { propertyId: { in: ids } }, include: unitInclude, orderBy: [{ property: { name: "asc" } }, { code: "asc" }] });
    const open = await openWoCounts("unitId", list.map((u) => u.id));
    res.json(list.map((u) => unitDTO(u, open)));
  } catch (e) {
    next(e);
  }
});

async function loadUnit(req: Request, id: string) {
  const u = await prisma.unit.findUnique({ where: { id }, include: unitInclude });
  if (!u) throw new HttpError(404, "Unit not found");
  await checkProperty(req, u.propertyId);
  return u;
}

assetsRouter.get("/units/:id", canRead, async (req, res, next) => {
  try {
    const u = await loadUnit(req, req.params.id);
    const [assets, meters, workOrders] = await Promise.all([
      prisma.asset.findMany({ where: { unitId: u.id }, select: { id: true, tag: true, name: true, category: true, status: true }, orderBy: { tag: "asc" } }),
      prisma.meter.findMany({ where: { unitId: u.id }, select: { id: true, code: true, meterClass: true, utility: true, unitOfMeasure: true }, orderBy: { code: "asc" } }),
      prisma.workOrder.findMany({ where: { unitId: u.id }, select: { id: true, ticket: true, title: true, status: true, dateOpened: true, priority: true }, orderBy: { dateOpened: "desc" }, take: 50 }),
    ]);
    const open = await openWoCounts("unitId", [u.id]);
    res.json({ ...unitDTO(u, open), assets, meters, workOrders: workOrders.map((w) => ({ ...w, dateOpened: day(w.dateOpened) })) });
  } catch (e) {
    next(e);
  }
});

assetsRouter.post("/units", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const b = unitCreate.parse(req.body);
    await checkProperty(req, b.propertyId);
    if (await prisma.unit.findUnique({ where: { propertyId_code: { propertyId: b.propertyId, code: b.code } } })) throw new HttpError(409, `Unit ${b.code} already exists in this building`);
    const u = await prisma.unit.create({ data: b });
    await audit(req.user!, "unit.create", { id: u.id, code: u.code });
    res.status(201).json(unitDTO(await loadUnit(req, u.id), new Map()));
  } catch (e) {
    next(e);
  }
});

/** Adds or updates many units at once (matched by code), e.g. from a pasted spreadsheet. */
assetsRouter.post("/units/import", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const b = z.object({ propertyId: z.string().min(1), rows: z.array(unitCreate.omit({ propertyId: true })).min(1).max(5000) }).parse(req.body);
    await checkProperty(req, b.propertyId);
    const codes = b.rows.map((r) => r.code.toUpperCase());
    const dup = codes.find((c, i) => codes.indexOf(c) !== i);
    if (dup) throw new HttpError(400, `Unit ${dup} appears twice in the import`);
    let created = 0, updated = 0;
    await prisma.$transaction(async (tx) => {
      for (const r of b.rows) {
        const have = await tx.unit.findUnique({ where: { propertyId_code: { propertyId: b.propertyId, code: r.code } } });
        if (have) { await tx.unit.update({ where: { id: have.id }, data: r }); updated++; }
        else { await tx.unit.create({ data: { ...r, propertyId: b.propertyId } }); created++; }
      }
    }, { timeout: 60_000 });
    await audit(req.user!, "unit.import", { propertyId: b.propertyId, created, updated });
    res.json({ created, updated });
  } catch (e) {
    next(e);
  }
});

assetsRouter.patch("/units/:id", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const u = await loadUnit(req, req.params.id);
    const b = z.object(unitFields).partial().strict().parse(req.body);
    if (b.code && b.code !== u.code && (await prisma.unit.findUnique({ where: { propertyId_code: { propertyId: u.propertyId, code: b.code } } }))) {
      throw new HttpError(409, `Unit ${b.code} already exists in this building`);
    }
    await prisma.unit.update({ where: { id: u.id }, data: b });
    await audit(req.user!, "unit.update", { id: u.id, fields: Object.keys(b) });
    res.json(unitDTO(await loadUnit(req, u.id), await openWoCounts("unitId", [u.id])));
  } catch (e) {
    next(e);
  }
});

assetsRouter.delete("/units/:id", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const u = await loadUnit(req, req.params.id);
    const wos = await prisma.workOrder.count({ where: { unitId: u.id } });
    if (wos || u._count.meters || u._count.assets) throw new HttpError(400, "This unit has work orders, meters or equipment linked to it. Set it to Inactive instead.");
    await prisma.unit.delete({ where: { id: u.id } });
    await audit(req.user!, "unit.delete", { id: u.id, code: u.code });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- equipment ----------
const assetInclude = { property: { select: { name: true } }, unit: { select: { code: true } }, parent: { select: { tag: true } } };
type AssetRow = Prisma.AssetGetPayload<{ include: typeof assetInclude }>;
const assetDTO = (a: AssetRow, open: Map<string, number>): AssetDTO => ({
  id: a.id, tag: a.tag, propertyId: a.propertyId, property: a.property.name, unitId: a.unitId, unitCode: a.unit?.code ?? null, parentId: a.parentId, parentTag: a.parent?.tag ?? null,
  name: a.name, category: a.category, trade: a.trade, location: a.location, make: a.make, model: a.model, serial: a.serial,
  installDate: day(a.installDate), warrantyUntil: day(a.warrantyUntil), critical: a.critical, status: a.status as AssetDTO["status"], notes: a.notes,
  openWorkOrders: open.get(a.id) ?? 0,
});

const assetFields = {
  tag: z.string().trim().min(1, "Give the asset a tag, e.g. I3-CH-01").max(60),
  unitId: z.string().nullable(),
  parentId: z.string().nullable(),
  name: z.string().trim().min(2, "Name the asset").max(200),
  category: z.string().trim().max(60),
  trade: z.string().trim().max(60),
  location: z.string().trim().max(200),
  make: z.string().trim().max(100),
  model: z.string().trim().max(100),
  serial: z.string().trim().max(100),
  installDate: date.nullable(),
  warrantyUntil: date.nullable(),
  critical: z.boolean(),
  status: z.enum(ASSET_STATUSES),
  notes: z.string().max(4000),
};
const assetCreate = z.object(assetFields).partial().extend({ propertyId: z.string().min(1), tag: assetFields.tag, name: assetFields.name });

async function checkLinks(propertyId: string, unitId: unknown, parentId: unknown, selfId?: string) {
  if (typeof unitId === "string") {
    const u = await prisma.unit.findUnique({ where: { id: unitId } });
    if (!u || u.propertyId !== propertyId) throw new HttpError(400, "That unit is not in this building");
  }
  if (typeof parentId === "string") {
    if (parentId === selfId) throw new HttpError(400, "An asset cannot be its own parent");
    let p = await prisma.asset.findUnique({ where: { id: parentId } });
    if (!p || p.propertyId !== propertyId) throw new HttpError(400, "The parent asset is not in this building");
    // No loops: walk up from the parent.
    for (let i = 0; p && i < 50; i++) {
      if (p.id === selfId) throw new HttpError(400, "That would make the asset its own ancestor");
      p = p.parentId ? await prisma.asset.findUnique({ where: { id: p.parentId } }) : null;
    }
  }
}
const toDates = (b: Record<string, unknown>) => {
  const d = { ...b };
  for (const k of ["installDate", "warrantyUntil"]) if (k in d) d[k] = d[k] ? new Date(d[k] as string) : null;
  return d;
};

assetsRouter.get("/items", canRead, async (req, res, next) => {
  try {
    const ids = await propertyFilter(req);
    const q = z.object({ unitId: z.string().optional(), q: z.string().max(200).optional() }).parse({ unitId: req.query.unitId, q: req.query.q });
    const where: Prisma.AssetWhereInput = { propertyId: { in: ids } };
    if (q.unitId) where.unitId = q.unitId;
    if (q.q) where.OR = ["tag", "name", "category", "location", "serial", "make", "model"].map((f) => ({ [f]: { contains: q.q, mode: "insensitive" } }));
    const list = await prisma.asset.findMany({ where, include: assetInclude, orderBy: [{ property: { name: "asc" } }, { tag: "asc" }], take: 5000 });
    const open = await openWoCounts("assetId", list.map((a) => a.id));
    res.json(list.map((a) => assetDTO(a, open)));
  } catch (e) {
    next(e);
  }
});

async function loadAsset(req: Request, id: string) {
  const a = await prisma.asset.findUnique({ where: { id }, include: assetInclude });
  if (!a) throw new HttpError(404, "Asset not found");
  await checkProperty(req, a.propertyId);
  return a;
}

assetsRouter.get("/items/:id", canRead, async (req, res, next) => {
  try {
    const a = await loadAsset(req, req.params.id);
    const [children, meters, workOrders] = await Promise.all([
      prisma.asset.findMany({ where: { parentId: a.id }, select: { id: true, tag: true, name: true, status: true }, orderBy: { tag: "asc" } }),
      prisma.meter.findMany({ where: { assetId: a.id }, select: { id: true, code: true, meterClass: true } }),
      prisma.workOrder.findMany({ where: { assetId: a.id }, select: { id: true, ticket: true, title: true, status: true, dateOpened: true, priority: true, completedAt: true }, orderBy: { dateOpened: "desc" }, take: 100 }),
    ]);
    const open = await openWoCounts("assetId", [a.id]);
    res.json({ ...assetDTO(a, open), children, meters, workOrders: workOrders.map((w) => ({ ...w, dateOpened: day(w.dateOpened), completedAt: w.completedAt?.toISOString() ?? null })) });
  } catch (e) {
    next(e);
  }
});

assetsRouter.post("/items", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const b = assetCreate.parse(req.body);
    await checkProperty(req, b.propertyId);
    await checkLinks(b.propertyId, b.unitId, b.parentId);
    if (await prisma.asset.findUnique({ where: { tag: b.tag } })) throw new HttpError(409, `Asset tag ${b.tag} is already in use`);
    const a = await prisma.asset.create({ data: toDates(b) as Prisma.AssetUncheckedCreateInput });
    await audit(req.user!, "asset.create", { id: a.id, tag: a.tag });
    res.status(201).json(assetDTO(await loadAsset(req, a.id), new Map()));
  } catch (e) {
    next(e);
  }
});

assetsRouter.patch("/items/:id", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const a = await loadAsset(req, req.params.id);
    const b = z.object(assetFields).partial().strict().parse(req.body);
    await checkLinks(a.propertyId, b.unitId, b.parentId, a.id);
    if (b.tag && b.tag !== a.tag && (await prisma.asset.findUnique({ where: { tag: b.tag } }))) throw new HttpError(409, `Asset tag ${b.tag} is already in use`);
    await prisma.asset.update({ where: { id: a.id }, data: toDates(b) as Prisma.AssetUncheckedUpdateInput });
    await audit(req.user!, "asset.update", { id: a.id, fields: Object.keys(b) });
    res.json(assetDTO(await loadAsset(req, a.id), await openWoCounts("assetId", [a.id])));
  } catch (e) {
    next(e);
  }
});

assetsRouter.delete("/items/:id", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const a = await loadAsset(req, req.params.id);
    const linked = (await prisma.workOrder.count({ where: { assetId: a.id } })) + (await prisma.asset.count({ where: { parentId: a.id } })) + (await prisma.meter.count({ where: { assetId: a.id } }));
    if (linked) throw new HttpError(400, "This asset has work orders, meters or sub-assets linked to it. Set it to Retired instead.");
    await prisma.asset.delete({ where: { id: a.id } });
    await audit(req.user!, "asset.delete", { id: a.id, tag: a.tag });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
