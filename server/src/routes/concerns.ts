import { Router, type Request } from "express";
import { z } from "zod";
import multer from "multer";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { CONCERN_STATUS, TRADES, type ConcernDTO } from "@pmd/shared";
import { prisma, audit, scopeOf } from "../db.ts";
import { HttpError, requireAuth } from "../auth.ts";

export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED = /^(image\/(png|jpeg|gif|webp|heic)|application\/pdf|text\/(plain|csv))$/;
export const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (_r, _f, cb) => cb(null, crypto.randomUUID()) }),
  limits: { fileSize: 20 * 1024 * 1024, files: 5 },
  fileFilter: (_r, f, cb) => cb(null, ALLOWED.test(f.mimetype)),
});

export const concernsRouter = Router();
concernsRouter.use(requireAuth);

const include = { updates: { include: { author: true }, orderBy: { createdAt: "asc" as const } }, createdBy: true };
type Full = Awaited<ReturnType<typeof prisma.concern.findFirstOrThrow<{ include: typeof include }>>>;

async function dto(c: Full, forTenant: boolean): Promise<ConcernDTO> {
  const atts = await prisma.attachment.findMany({ where: { OR: [{ ownerType: "concern", ownerId: c.id }, { ownerType: "update", ownerId: { in: c.updates.map((u) => u.id) } }] } });
  const a = (type: string, id: string) => atts.filter((x) => x.ownerType === type && x.ownerId === id).map((x) => ({ id: x.id, filename: x.filename, mime: x.mime, size: x.size }));
  return {
    id: c.id, controlNo: c.controlNo, property: c.property, tenantName: c.tenantName, trade: c.trade, location: c.location, concern: c.concern,
    status: c.status as ConcernDTO["status"], createdAt: c.createdAt.toISOString(), receivedAt: c.receivedAt?.toISOString() ?? null, receivedBy: c.receivedBy,
    createdByName: c.createdBy.name,
    updates: c.updates.map((u) => ({ id: u.id, kind: u.kind as "followup", message: u.message, authorName: forTenant && u.author.role !== "Tenant" ? "Property management" : u.author.name, authorRole: u.author.role, createdAt: u.createdAt.toISOString(), attachments: a("update", u.id) })),
    attachments: a("concern", c.id),
    unseenFollowups: c.updates.filter((u) => u.kind === "followup" && !u.seenAt).length,
  };
}

async function loadFor(req: Request, id: string) {
  const c = await prisma.concern.findUnique({ where: { id }, include });
  if (!c) throw new HttpError(404, "Concern not found");
  const u = req.user!;
  if (u.role === "Tenant") {
    if (c.createdById !== u.id) throw new HttpError(404, "Concern not found");
  } else if (!(await scopeOf(u)).includes(c.property)) throw new HttpError(404, "Concern not found");
  return c;
}

async function saveFiles(req: Request, ownerType: string, ownerId: string, property: string) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  for (const f of files) await prisma.attachment.create({ data: { ownerType, ownerId, filename: f.originalname.slice(0, 200), mime: f.mimetype, size: f.size, storedName: f.filename, property, createdById: req.user!.id } });
}

async function nextControlNo() {
  const y = new Date().getFullYear();
  const n = await prisma.concern.count({ where: { controlNo: { startsWith: `TC-${y}-` } } });
  return `TC-${y}-${String(n + 1).padStart(4, "0")}`;
}

concernsRouter.get("/", async (req, res, next) => {
  try {
    const u = req.user!;
    const where = u.role === "Tenant" ? { createdById: u.id } : { property: { in: await scopeOf(u) } };
    const list = await prisma.concern.findMany({ where, include, orderBy: { createdAt: "desc" }, take: 500 });
    res.json(await Promise.all(list.map((c) => dto(c, u.role === "Tenant"))));
  } catch (e) {
    next(e);
  }
});

/** Buildings the current user can raise concerns for (tenants: their own). */
concernsRouter.get("/buildings", async (req, res, next) => {
  try {
    res.json(await scopeOf(req.user!));
  } catch (e) {
    next(e);
  }
});

concernsRouter.post("/", upload.array("files", 5), async (req, res, next) => {
  try {
    const u = req.user!;
    const b = z.object({ property: z.string().min(1), trade: z.enum(TRADES), location: z.string().max(200).default(""), concern: z.string().trim().min(3).max(4000), tenantName: z.string().max(200).optional() }).parse(req.body);
    if (!(await scopeOf(u)).includes(b.property)) throw new HttpError(403, "Not your building");
    const c = await prisma.concern.create({ data: { controlNo: await nextControlNo(), property: b.property, trade: b.trade, location: b.location, concern: b.concern, tenantName: u.role === "Tenant" ? u.name : b.tenantName || u.name, createdById: u.id } });
    await saveFiles(req, "concern", c.id, c.property);
    await audit(u, "concern.create", { id: c.id, controlNo: c.controlNo });
    res.status(201).json(await dto(await loadFor(req, c.id), u.role === "Tenant"));
  } catch (e) {
    next(e);
  }
});

/** Staff marks a concern received; it is copied to the Concern slips register. */
concernsRouter.post("/:id/receive", async (req, res, next) => {
  try {
    const u = req.user!;
    if (u.role === "Tenant") throw new HttpError(403, "Staff only");
    const c = await loadFor(req, req.params.id);
    if (c.receivedAt) {
      await prisma.concernUpdate.updateMany({ where: { concernId: c.id, kind: "followup", seenAt: null }, data: { seenAt: new Date() } });
    } else {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const slip = await prisma.datasetRow.create({ data: { dataset: "cs", property: c.property, createdById: u.id, updatedById: u.id, data: { control_no: c.controlNo, property: c.property, concern: c.concern + (c.location ? ` (${c.location})` : ""), trade: c.trade, requested_by: c.createdBy.name, company: c.tenantName, received_by: u.name, date_received: ts, responded_by: "", date_responded: "", action_taken: "", resolution_date: "", date_closed: "", work_order: "", tenant_account: c.createdBy.email, tenant_update: "" } } });
      await prisma.concern.update({ where: { id: c.id }, data: { receivedAt: now, receivedBy: u.name, status: "Received", slipRowId: slip.id } });
      await prisma.concernUpdate.create({ data: { concernId: c.id, kind: "status", message: "Received by property management", authorId: u.id, seenAt: now } });
    }
    await audit(u, "concern.receive", { id: c.id });
    res.json(await dto(await loadFor(req, c.id), false));
  } catch (e) {
    next(e);
  }
});

/** Tenant follow-up or staff response, optionally changing status. */
concernsRouter.post("/:id/updates", upload.array("files", 5), async (req, res, next) => {
  try {
    const u = req.user!;
    const c = await loadFor(req, req.params.id);
    const b = z.object({ message: z.string().trim().min(1).max(4000), status: z.enum(CONCERN_STATUS).optional() }).parse(req.body);
    const isTenant = u.role === "Tenant";
    const upd = await prisma.concernUpdate.create({ data: { concernId: c.id, kind: isTenant ? "followup" : "response", message: b.message, authorId: u.id, seenAt: isTenant ? null : new Date() } });
    await saveFiles(req, "update", upd.id, c.property);
    if (!isTenant && b.status && b.status !== c.status) {
      await prisma.concern.update({ where: { id: c.id }, data: { status: b.status } });
      await prisma.concernUpdate.create({ data: { concernId: c.id, kind: "status", message: `Status changed to ${b.status}`, authorId: u.id, seenAt: new Date() } });
      if (c.slipRowId) {
        const slip = await prisma.datasetRow.findUnique({ where: { id: c.slipRowId } });
        if (slip) {
          const d = { ...(slip.data as Record<string, string>) };
          const now = new Date(), pad = (n: number) => String(n).padStart(2, "0");
          const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
          if (!d.date_responded) { d.date_responded = ts; d.responded_by = u.name; }
          d.tenant_update = b.message;
          if (b.status === "Resolved" && !d.resolution_date) d.resolution_date = ts;
          if (b.status === "Closed" && !d.work_order) { d.date_closed = ts; d.action_taken ||= b.message; }
          await prisma.datasetRow.update({ where: { id: slip.id }, data: { data: d, updatedById: u.id } });
        }
      }
    }
    await audit(u, isTenant ? "concern.followup" : "concern.respond", { id: c.id });
    res.status(201).json(await dto(await loadFor(req, c.id), isTenant));
  } catch (e) {
    next(e);
  }
});

concernsRouter.get("/attachments/:id", async (req, res, next) => {
  try {
    const a = await prisma.attachment.findUnique({ where: { id: req.params.id } });
    if (!a) throw new HttpError(404, "File not found");
    const concernId = a.ownerType === "concern" ? a.ownerId : a.ownerType === "update" ? (await prisma.concernUpdate.findUnique({ where: { id: a.ownerId } }))?.concernId : null;
    if (!concernId) throw new HttpError(404, "File not found");
    await loadFor(req, concernId); // permission check
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", `inline; filename="${a.filename.replace(/["\\\r\n]/g, "_")}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.sendFile(path.join(UPLOAD_DIR, path.basename(a.storedName)));
  } catch (e) {
    next(e);
  }
});
