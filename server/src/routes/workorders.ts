import { Router, type Request } from "express";
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  ACTIVITY_TYPES, TRADES, WO_ASSIGNABLE_ROLES, WO_NEEDS_NOTE, WO_PRIORITIES, WO_STATUSES,
  allowedMoves, canAssign, canEditDetails, canEditWorkNotes, scopeFor, woToLegacyRow,
  isWoManager, type Role, type SessionUser, type WoStatus, type WorkOrderDTO,
} from "@pmd/shared";
import { prisma, allProperties, audit, scopeOf } from "../db.ts";
import { HttpError, requireTab, staffOnly } from "../auth.ts";
import { UPLOAD_DIR, upload } from "./concerns.ts";
import { sniffFile } from "../portal/security.ts";

export const workOrdersRouter = Router();
workOrdersRouter.use(staffOnly, requireTab("wos", 1));
const canWrite = requireTab("wos", 2);

const include = {
  assignees: { include: { user: { select: { id: true, name: true, role: true } } }, orderBy: { assignedAt: "asc" as const } },
  createdBy: { select: { name: true } },
  unit: { select: { code: true } },
  assetRec: { select: { tag: true, name: true } },
};
const includeEvents = {
  ...include,
  events: { include: { author: { select: { name: true, role: true } } }, orderBy: { createdAt: "asc" as const } },
};
type WoFull = Prisma.WorkOrderGetPayload<{ include: typeof include }>;
type WoWithEvents = Prisma.WorkOrderGetPayload<{ include: typeof includeEvents }>;

const day = (d: Date) => d.toISOString().slice(0, 10);
const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function toDTO(w: WoFull | WoWithEvents): WorkOrderDTO {
  const dto: WorkOrderDTO = {
    id: w.id, ticket: w.ticket, property: w.property, title: w.title, description: w.description,
    activityType: w.activityType as WorkOrderDTO["activityType"], trade: w.trade, priority: w.priority as WorkOrderDTO["priority"], status: w.status as WoStatus,
    location: w.location, asset: w.asset, reportedBy: w.reportedBy, tenant: w.tenant, rootCause: w.rootCause, remarks: w.remarks,
    estCost: w.estCost == null ? null : Number(w.estCost), chargeable: w.chargeable,
    dateOpened: day(w.dateOpened), targetDate: day(w.targetDate),
    startedAt: iso(w.startedAt), completedAt: iso(w.completedAt), closedAt: iso(w.closedAt),
    holdReason: w.holdReason, reason: w.reason, actionTaken: w.actionTaken, ownerName: w.ownerName, concernId: w.concernId,
    unitId: w.unitId, unitCode: w.unit?.code ?? null, assetId: w.assetId, assetTag: w.assetRec?.tag ?? null, assetName: w.assetRec?.name ?? null,
    assignees: w.assignees.map((a) => a.user),
    createdByName: w.createdBy?.name ?? null, createdAt: w.createdAt.toISOString(), updatedAt: w.updatedAt.toISOString(),
  };
  if ("events" in w) {
    dto.events = w.events.map((e) => ({
      id: e.id, kind: e.kind as "comment", fromStatus: e.fromStatus, toStatus: e.toStatus, message: e.message,
      authorName: e.author?.name ?? "System", authorRole: e.author?.role ?? "", createdAt: e.createdAt.toISOString(),
    }));
  }
  return dto;
}

/** Work orders in the user's buildings, in the column shape of the old "m" register (for the KPI engine). */
export async function legacyWorkOrderRows(scope: string[]) {
  const list = await prisma.workOrder.findMany({ where: { property: { in: scope }, status: { not: "Cancelled" } }, include, orderBy: { createdAt: "asc" } });
  return list.map((w): Record<string, string> & { _id: string } => ({ ...woToLegacyRow(toDTO(w)), _id: w.id }));
}

async function load(req: Request, id: string, withEvents = false) {
  const w = await prisma.workOrder.findUnique({ where: { id }, include: withEvents ? includeEvents : include });
  if (!w || !(await scopeOf(req.user!)).includes(w.property)) throw new HttpError(404, "Work order not found");
  return w;
}
const ids = (w: WoFull) => w.assignees.map((a) => a.userId);

/** One work order with its history and photos, as sent to the browser. */
async function full(req: Request, id: string): Promise<WorkOrderDTO> {
  const dto = toDTO(await load(req, id, true));
  const atts = await prisma.attachment.findMany({ where: { ownerType: "wo", ownerId: id }, orderBy: { createdAt: "asc" } });
  const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...new Set(atts.map((a) => a.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  dto.photos = atts.map((a) => ({ id: a.id, filename: a.filename, mime: a.mime, size: a.size, byId: a.createdById, byName: names[a.createdById] ?? "Unknown", createdAt: a.createdAt.toISOString() }));
  return dto;
}

export async function nextTicket(tx: Prisma.TransactionClient = prisma) {
  const y = new Date().getFullYear();
  for (;;) {
    const [{ n }] = await tx.$queryRaw<{ n: bigint }[]>`SELECT nextval('"WorkOrder_ticket_seq"') AS n`;
    const t = `WO-${y}-${String(n).padStart(5, "0")}`;
    if (!(await tx.workOrder.findUnique({ where: { ticket: t } }))) return t;
  }
}

/** Active staff who may be assigned work in this building. */
async function assignableFor(property: string) {
  const [users, props] = await Promise.all([
    prisma.user.findMany({ where: { active: true, role: { in: [...WO_ASSIGNABLE_ROLES] } }, orderBy: [{ role: "asc" }, { name: "asc" }] }),
    allProperties(),
  ]);
  return users.filter((u) => scopeFor({ role: u.role as Role, section: u.section, properties: u.properties }, props).includes(property)).map((u) => ({ id: u.id, name: u.name, role: u.role }));
}

async function checkAssignees(property: string, userIds: string[]) {
  const ok = new Set((await assignableFor(property)).map((u) => u.id));
  const bad = userIds.filter((i) => !ok.has(i));
  if (bad.length) throw new HttpError(400, "Someone you picked cannot be assigned work in this building");
}

/** The linked unit and asset must be in the work order's building (and the asset in the unit, if both are given). */
async function checkLinks(property: string, unitId: string | null | undefined, assetId: string | null | undefined) {
  if (unitId) {
    const u = await prisma.unit.findUnique({ where: { id: unitId }, include: { property: { select: { name: true } } } });
    if (!u || u.property.name !== property) throw new HttpError(400, "That unit is not in this building");
  }
  if (assetId) {
    const a = await prisma.asset.findUnique({ where: { id: assetId }, include: { property: { select: { name: true } } } });
    if (!a || a.property.name !== property) throw new HttpError(400, "That asset is not in this building");
  }
}

const event = (tx: Prisma.TransactionClient, workOrderId: string, u: SessionUser, kind: string, data: { fromStatus?: string; toStatus?: string; message?: string; detail?: object } = {}) =>
  tx.workOrderEvent.create({ data: { workOrderId, authorId: u.id, kind, ...data } });

// ---------- list & read ----------
workOrdersRouter.get("/", async (req, res, next) => {
  try {
    const u = req.user!;
    const q = z.object({
      property: z.string().optional(),
      status: z.string().optional(), // one status, or "open" / "done" / "all"
      mine: z.enum(["1", "0"]).optional(),
      q: z.string().max(200).optional(),
    }).parse(req.query);
    const scope = await scopeOf(u);
    if (q.property && !scope.includes(q.property)) throw new HttpError(403, "Not your building");
    const where: Prisma.WorkOrderWhereInput = { property: q.property ? q.property : { in: scope } };
    if (q.status === "open") where.status = { in: ["New", "Assigned", "In Progress", "On Hold", "Completed"] };
    else if (q.status === "done") where.status = { in: ["Closed", "Cancelled"] };
    else if (q.status && q.status !== "all") where.status = q.status;
    if (q.mine === "1") where.assignees = { some: { userId: u.id } };
    if (q.q) where.OR = ["ticket", "title", "description", "asset", "location", "tenant"].map((f) => ({ [f]: { contains: q.q, mode: "insensitive" } }));
    const list = await prisma.workOrder.findMany({ where, include, orderBy: [{ targetDate: "asc" }, { createdAt: "asc" }], take: 2000 });
    res.json(list.map(toDTO));
  } catch (e) {
    next(e);
  }
});

workOrdersRouter.get("/assignees", async (req, res, next) => {
  try {
    const property = z.string().min(1).parse(req.query.property);
    if (!(await scopeOf(req.user!)).includes(property)) throw new HttpError(403, "Not your building");
    res.json(await assignableFor(property));
  } catch (e) {
    next(e);
  }
});

workOrdersRouter.get("/:id", async (req, res, next) => {
  try {
    res.json(await full(req, req.params.id));
  } catch (e) {
    next(e);
  }
});

// ---------- create ----------
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-01-31");
const details = {
  title: z.string().trim().min(3, "Give the work order a short title").max(200),
  description: z.string().max(4000),
  activityType: z.enum(ACTIVITY_TYPES),
  trade: z.union([z.enum(TRADES), z.literal("")]),
  priority: z.enum(WO_PRIORITIES),
  location: z.string().max(200),
  asset: z.string().max(200),
  reportedBy: z.string().max(200),
  tenant: z.string().max(200),
  targetDate: date,
  estCost: z.number().nonnegative().nullable(),
  chargeable: z.boolean(),
  ownerName: z.string().max(200),
  unitId: z.string().nullable(),
  assetId: z.string().nullable(),
};
const notes = { actionTaken: z.string().max(4000), rootCause: z.string().max(4000), remarks: z.string().max(4000), reason: z.string().max(4000) };

const createBody = z.object({
  property: z.string().min(1),
  ...details,
  description: details.description.default(""),
  activityType: details.activityType.default("Reactive"),
  trade: details.trade.default(""),
  priority: details.priority.default("Medium"),
  location: details.location.default(""),
  asset: details.asset.default(""),
  reportedBy: details.reportedBy.optional(),
  tenant: details.tenant.default(""),
  estCost: details.estCost.default(null),
  chargeable: details.chargeable.default(false),
  ownerName: details.ownerName.default(""),
  unitId: details.unitId.default(null),
  assetId: details.assetId.default(null),
  dateOpened: date.optional(),
  assigneeIds: z.array(z.string()).max(20).default([]),
  concernId: z.string().optional(),
});

workOrdersRouter.post("/", canWrite, async (req, res, next) => {
  try {
    const u = req.user!;
    const b = createBody.parse(req.body);
    if (!(await scopeOf(u)).includes(b.property)) throw new HttpError(403, "Not your building");
    const assigneeIds = [...new Set(b.assigneeIds)];
    if (assigneeIds.length && !canAssign(u)) throw new HttpError(403, "Only supervisors can assign work orders");
    await checkAssignees(b.property, assigneeIds);
    await checkLinks(b.property, b.unitId, b.assetId);
    const opened = b.dateOpened ?? day(new Date());
    if (b.targetDate < opened) throw new HttpError(400, "The target date is before the date opened");
    let concern = null;
    if (b.concernId) {
      concern = await prisma.concern.findUnique({ where: { id: b.concernId } });
      if (!concern || concern.property !== b.property) throw new HttpError(400, "That concern is not for this building");
    }
    const { assigneeIds: _a, concernId: _c, dateOpened: _d, ...fields } = b;
    // A concern raised for a unit (owner/tenant portal) carries its unit over.
    if (!fields.unitId && concern?.unitId) fields.unitId = concern.unitId;
    // Keep the text column filled for the dashboards and CSV exports.
    if (fields.assetId && !fields.asset) {
      const a = await prisma.asset.findUnique({ where: { id: fields.assetId }, select: { tag: true, name: true } });
      if (a) fields.asset = `${a.tag} ${a.name}`;
    }
    const created = await prisma.$transaction(async (tx) => {
      const w = await tx.workOrder.create({
        data: {
          ...fields, reportedBy: b.reportedBy ?? u.name, ticket: await nextTicket(tx), dateOpened: new Date(opened), targetDate: new Date(b.targetDate),
          status: assigneeIds.length ? "Assigned" : "New", concernId: concern?.id, createdById: u.id, updatedById: u.id,
          assignees: { create: assigneeIds.map((userId) => ({ userId, assignedById: u.id })) },
        },
        include,
      });
      await event(tx, w.id, u, "created", { toStatus: w.status, message: concern ? `Created from tenant concern ${concern.controlNo}` : "" });
      if (assigneeIds.length) await event(tx, w.id, u, "assign", { message: "Assigned to " + w.assignees.map((a) => a.user.name).join(", "), detail: { added: assigneeIds } });
      if (concern?.slipRowId) {
        const slip = await tx.datasetRow.findUnique({ where: { id: concern.slipRowId } });
        if (slip && !(slip.data as Record<string, string>).work_order) await tx.datasetRow.update({ where: { id: slip.id }, data: { data: { ...(slip.data as object), work_order: w.ticket }, updatedById: u.id } });
      }
      return w;
    });
    await audit(u, "wo.create", { id: created.id, ticket: created.ticket });
    res.status(201).json(await full(req, created.id));
  } catch (e) {
    next(e);
  }
});

// ---------- edit details ----------
const LABELS: Record<string, string> = {
  title: "title", description: "description", activityType: "activity type", trade: "trade", priority: "priority", location: "location", asset: "asset",
  reportedBy: "reported by", tenant: "tenant", targetDate: "target date", estCost: "estimated cost", chargeable: "chargeable", ownerName: "owner",
  unitId: "unit", assetId: "asset record",
  actionTaken: "action taken", rootCause: "root cause", remarks: "remarks", reason: "reason for delay",
};

workOrdersRouter.patch("/:id", canWrite, async (req, res, next) => {
  try {
    const u = req.user!;
    const w = await load(req, req.params.id);
    const manager = canEditDetails(u);
    if (!canEditWorkNotes(u, { assigneeIds: ids(w) })) throw new HttpError(403, "Only the assigned technicians or a supervisor can edit this work order");
    const b = z.object(manager ? { ...details, ...notes } : notes).partial().strict().parse(req.body) as Record<string, unknown>;
    await checkLinks(w.property, b.unitId as string | null | undefined, b.assetId as string | null | undefined);
    const data: Record<string, unknown> = {};
    const changed: string[] = [];
    for (const [k, v] of Object.entries(b)) {
      const before = k === "targetDate" ? day(w.targetDate) : k === "estCost" ? (w.estCost == null ? null : Number(w.estCost)) : (w as unknown as Record<string, unknown>)[k];
      if (v === undefined || v === before) continue;
      data[k] = k === "targetDate" ? new Date(v as string) : v;
      changed.push(LABELS[k] ?? k);
    }
    if (data.targetDate && (data.targetDate as Date) < w.dateOpened) throw new HttpError(400, "The target date is before the date opened");
    if (changed.length) {
      await prisma.$transaction(async (tx) => {
        await tx.workOrder.update({ where: { id: w.id }, data: { ...data, updatedById: u.id } });
        await event(tx, w.id, u, "edit", { message: "Updated " + changed.join(", "), detail: { fields: Object.keys(data) } });
      });
      await audit(u, "wo.update", { id: w.id, fields: Object.keys(data) });
    }
    res.json(await full(req, w.id));
  } catch (e) {
    next(e);
  }
});

// ---------- status ----------
workOrdersRouter.post("/:id/status", canWrite, async (req, res, next) => {
  try {
    const u = req.user!;
    const w = await load(req, req.params.id);
    const b = z.object({ status: z.enum(WO_STATUSES), note: z.string().trim().max(4000).default("") }).parse(req.body);
    const from = w.status as WoStatus, to = b.status;
    if (!allowedMoves(u, { status: from, assigneeIds: ids(w) }).includes(to)) {
      throw new HttpError(403, u.role === "Technician" && !ids(w).includes(u.id) ? "This work order is not assigned to you" : `You cannot move a work order from ${from} to ${to}`);
    }
    if (WO_NEEDS_NOTE[to] && !b.note) throw new HttpError(400, WO_NEEDS_NOTE[to]!);
    const now = new Date();
    const data: Prisma.WorkOrderUpdateManyMutationInput = { status: to };
    if (to === "In Progress") {
      if (!w.startedAt) data.startedAt = now;
      if (from === "Completed" || from === "Closed") { data.completedAt = null; data.closedAt = null; }
    }
    if (from === "On Hold") data.holdReason = "";
    if (to === "On Hold") data.holdReason = b.note;
    if (to === "Completed") {
      data.completedAt = now;
      data.actionTaken = w.actionTaken && w.actionTaken !== b.note ? `${w.actionTaken}\n${b.note}` : b.note;
    }
    if (to === "Closed") {
      data.closedAt = now;
      if (!w.completedAt) data.completedAt = now;
    }
    if (to === "New" && from === "Cancelled" && w.assignees.length) data.status = "Assigned";
    const finalStatus = data.status as WoStatus;
    await prisma.$transaction(async (tx) => {
      // Only update if nobody else changed the status in the meantime.
      const r = await tx.workOrder.updateMany({ where: { id: w.id, status: from }, data: { ...data, updatedById: u.id } });
      if (r.count !== 1) throw new HttpError(409, "Someone else just changed this work order. Reload and try again.");
      await event(tx, w.id, u, "status", { fromStatus: from, toStatus: finalStatus, message: b.note });
    });
    await audit(u, "wo.status", { id: w.id, from, to: finalStatus });
    res.json(await full(req, w.id));
  } catch (e) {
    next(e);
  }
});

// ---------- assignees ----------
workOrdersRouter.put("/:id/assignees", canWrite, async (req, res, next) => {
  try {
    const u = req.user!;
    if (!canAssign(u)) throw new HttpError(403, "Only supervisors can assign work orders");
    const w = await load(req, req.params.id);
    if (w.status === "Closed" || w.status === "Cancelled") throw new HttpError(400, `Reopen the work order before changing who it is assigned to`);
    const want = [...new Set(z.object({ userIds: z.array(z.string()).max(20) }).parse(req.body).userIds)];
    await checkAssignees(w.property, want);
    const have = ids(w);
    const added = want.filter((i) => !have.includes(i)), removed = have.filter((i) => !want.includes(i));
    if (added.length || removed.length) {
      const names = Object.fromEntries((await prisma.user.findMany({ where: { id: { in: [...added, ...removed] } }, select: { id: true, name: true } })).map((x) => [x.id, x.name]));
      await prisma.$transaction(async (tx) => {
        if (removed.length) await tx.workOrderAssignee.deleteMany({ where: { workOrderId: w.id, userId: { in: removed } } });
        if (added.length) await tx.workOrderAssignee.createMany({ data: added.map((userId) => ({ workOrderId: w.id, userId, assignedById: u.id })) });
        const msg = [added.length && "Assigned " + added.map((i) => names[i]).join(", "), removed.length && "Unassigned " + removed.map((i) => names[i]).join(", ")].filter(Boolean).join(" · ");
        await event(tx, w.id, u, "assign", { message: msg, detail: { added, removed } });
        let status: WoStatus | null = null;
        if (w.status === "New" && want.length) status = "Assigned";
        if (w.status === "Assigned" && !want.length) status = "New";
        await tx.workOrder.update({ where: { id: w.id }, data: { updatedById: u.id, ...(status ? { status } : {}) } });
        if (status) await event(tx, w.id, u, "status", { fromStatus: w.status, toStatus: status });
      });
      await audit(u, "wo.assign", { id: w.id, added, removed });
    }
    res.json(await full(req, w.id));
  } catch (e) {
    next(e);
  }
});

// ---------- comments ----------
workOrdersRouter.post("/:id/comments", canWrite, async (req, res, next) => {
  try {
    const u = req.user!;
    const w = await load(req, req.params.id);
    const { message } = z.object({ message: z.string().trim().min(1).max(4000) }).parse(req.body);
    await prisma.$transaction(async (tx) => {
      await event(tx, w.id, u, "comment", { message });
      await tx.workOrder.update({ where: { id: w.id }, data: { updatedById: u.id } });
    });
    res.status(201).json(await full(req, w.id));
  } catch (e) {
    next(e);
  }
});


// ---------- photos ----------
const PHOTO_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/gif"];
const removeFiles = (files: Express.Multer.File[]) => files.forEach((f) => fs.rm(f.path, { force: true }, () => undefined));

workOrdersRouter.post("/:id/photos", canWrite, upload.array("files", 5), async (req, res, next) => {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  try {
    const u = req.user!;
    const w = await load(req, req.params.id);
    if (!files.length) throw new HttpError(400, "Choose a photo (JPEG, PNG, WebP or HEIC)");
    // Trust the file content, not the name or the browser's label.
    const kinds = files.map((f) => sniffFile(f.path));
    if (kinds.some((k) => !k || !PHOTO_TYPES.includes(k))) throw new HttpError(400, "Only photos can be added here (JPEG, PNG, WebP or HEIC)");
    await prisma.$transaction(async (tx) => {
      await tx.attachment.createMany({
        data: files.map((f, i) => ({ ownerType: "wo", ownerId: w.id, filename: f.originalname.slice(0, 200) || "photo", mime: kinds[i]!, size: f.size, storedName: path.basename(f.path), property: w.property, createdById: u.id })),
      });
      await event(tx, w.id, u, "edit", { message: files.length === 1 ? "Added a photo" : `Added ${files.length} photos` });
      await tx.workOrder.update({ where: { id: w.id }, data: { updatedById: u.id } });
    });
    await audit(u, "wo.photo.add", { id: w.id, count: files.length });
    res.status(201).json(await full(req, w.id));
  } catch (e) {
    removeFiles(files);
    next(e);
  }
});

workOrdersRouter.get("/:id/photos/:photoId", async (req, res, next) => {
  try {
    const w = await load(req, req.params.id); // building permission check
    const a = await prisma.attachment.findUnique({ where: { id: req.params.photoId } });
    if (!a || a.ownerType !== "wo" || a.ownerId !== w.id) throw new HttpError(404, "Photo not found");
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", `inline; filename="${a.filename.replace(/["\\\r\n]/g, "_")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "sandbox; default-src 'none'; img-src 'self'");
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.sendFile(path.join(UPLOAD_DIR, path.basename(a.storedName)));
  } catch (e) {
    next(e);
  }
});

workOrdersRouter.delete("/:id/photos/:photoId", canWrite, async (req, res, next) => {
  try {
    const u = req.user!;
    const w = await load(req, req.params.id);
    const a = await prisma.attachment.findUnique({ where: { id: req.params.photoId } });
    if (!a || a.ownerType !== "wo" || a.ownerId !== w.id) throw new HttpError(404, "Photo not found");
    if (a.createdById !== u.id && !isWoManager(u.role)) throw new HttpError(403, "Only the person who added a photo or a supervisor can remove it");
    await prisma.$transaction(async (tx) => {
      await tx.attachment.delete({ where: { id: a.id } });
      await event(tx, w.id, u, "edit", { message: `Removed photo ${a.filename}` });
    });
    fs.rm(path.join(UPLOAD_DIR, path.basename(a.storedName)), { force: true }, () => undefined);
    await audit(u, "wo.photo.remove", { id: w.id, photo: a.id });
    res.json(await full(req, w.id));
  } catch (e) {
    next(e);
  }
});
