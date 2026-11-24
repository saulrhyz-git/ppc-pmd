import { Router } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { randomBytes } from "node:crypto";
import { defaultTabs, mergeThresholds, ROLES, TABS, WO_OPEN, type Role } from "@pmd/shared";
import { prisma, allProperties, audit, getAsOf, getThresholds, setSetting } from "../db.ts";
import { HttpError, requireAuth, requireRole, toSessionUser } from "../auth.ts";

export const adminRouter = Router();
adminRouter.use(requireAuth);

// Anyone signed in (staff) can read the building list and settings they need to render screens.
adminRouter.get("/meta", async (req, res, next) => {
  try {
    const [props, sections, asOf, thresholds] = await Promise.all([allProperties(), prisma.section.findMany({ orderBy: { sortOrder: "asc" } }), getAsOf(), getThresholds()]);
    res.json({ properties: props, sections: sections.map((s) => s.name), asOf, thresholds, roles: ROLES, tabs: TABS });
  } catch (e) {
    next(e);
  }
});

const DH = requireRole("Department Head");

// ---------- users ----------
const tabsSchema = z.record(z.union([z.literal(0), z.literal(1), z.literal(2)])).optional();
const userBody = z.object({
  email: z.string().trim().toLowerCase().email(),
  name: z.string().trim().min(1).max(200),
  role: z.enum(ROLES),
  section: z.string().nullable().optional(),
  properties: z.array(z.string()).default([]),
  canApprove: z.boolean().default(false),
  active: z.boolean().default(true),
  tabs: tabsSchema,
  password: z.string().min(8, "Password must be at least 8 characters").optional(),
});

/** Deleted users keep their row (so work orders, readings and history still show who did what) under this email domain. */
const DELETED_DOMAIN = "@deleted.invalid";

const publicUser = (u: Parameters<typeof toSessionUser>[0] & { active: boolean; lastLoginAt: Date | null }) => ({ ...toSessionUser(u), active: u.active, lastLoginAt: u.lastLoginAt });

adminRouter.get("/users", DH, async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({ where: { NOT: { email: { endsWith: DELETED_DOMAIN } } }, orderBy: [{ role: "asc" }, { name: "asc" }] });
    res.json(users.map(publicUser));
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/users", DH, async (req, res, next) => {
  try {
    const b = userBody.parse(req.body);
    if (!b.password) throw new HttpError(400, "Set a starting password");
    if (await prisma.user.findUnique({ where: { email: b.email } })) throw new HttpError(409, "A user with that email already exists");
    const u = await prisma.user.create({ data: { email: b.email, name: b.name, role: b.role, section: b.section ?? null, properties: b.properties, canApprove: b.canApprove, active: b.active, tabs: b.tabs ?? defaultTabs(b.role as Role), passwordHash: await bcrypt.hash(b.password, 12) } });
    await audit(req.user!, "user.create", { id: u.id, email: u.email, role: u.role });
    res.status(201).json(publicUser(u));
  } catch (e) {
    next(e);
  }
});

adminRouter.put("/users/:id", DH, async (req, res, next) => {
  try {
    const b = userBody.parse(req.body);
    const old = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!old) throw new HttpError(404, "User not found");
    if (old.id === req.user!.id && (b.role !== "Department Head" || !b.active)) throw new HttpError(400, "You cannot remove your own Department Head access");
    const u = await prisma.user.update({ where: { id: old.id }, data: { email: b.email, name: b.name, role: b.role, section: b.section ?? null, properties: b.properties, canApprove: b.canApprove, active: b.active, tabs: b.tabs ?? defaultTabs(b.role as Role), ...(b.password ? { passwordHash: await bcrypt.hash(b.password, 12), failedLogins: 0, lockedUntil: null } : {}) } });
    if (!u.active || b.password) await prisma.$executeRawUnsafe(`DELETE FROM "session" WHERE sess->>'userId' = $1`, u.id).catch(() => undefined);
    await audit(req.user!, "user.update", { id: u.id, changes: { role: [old.role, u.role], active: [old.active, u.active], passwordReset: !!b.password } });
    res.json(publicUser(u));
  } catch (e) {
    next(e);
  }
});

/**
 * Deletes a staff user. The row is kept but anonymised and locked out for good, so history
 * (work orders, meter readings, concern updates) still reads "<name> (deleted)" instead of losing the author.
 */
adminRouter.delete("/users/:id", DH, async (req, res, next) => {
  try {
    const old = await prisma.user.findUnique({ where: { id: req.params.id } });
    if (!old || old.email.endsWith(DELETED_DOMAIN)) throw new HttpError(404, "User not found");
    if (old.id === req.user!.id) throw new HttpError(400, "You cannot delete your own account");
    if (old.role === "Department Head") {
      const others = await prisma.user.count({ where: { id: { not: old.id }, role: "Department Head", active: true, NOT: { email: { endsWith: DELETED_DOMAIN } } } });
      if (!others) throw new HttpError(400, "This is the last active Department Head. Make someone else Department Head first.");
    }
    const unassigned = await prisma.$transaction(async (tx) => {
      // Take them off work orders that are still open, and note it in each work order's history.
      const open = await tx.workOrderAssignee.findMany({ where: { userId: old.id, workOrder: { status: { in: [...WO_OPEN] } } }, select: { workOrderId: true } });
      for (const { workOrderId } of open) {
        await tx.workOrderAssignee.delete({ where: { workOrderId_userId: { workOrderId, userId: old.id } } });
        await tx.workOrderEvent.create({ data: { workOrderId, authorId: req.user!.id, kind: "assign", message: `Unassigned ${old.name} (user deleted)`, detail: { removed: [old.id] } } });
      }
      await tx.user.update({
        where: { id: old.id },
        data: {
          name: `${old.name} (deleted)`, email: `deleted+${old.id}${DELETED_DOMAIN}`, active: false, canApprove: false, properties: [], section: null, tabs: {},
          passwordHash: await bcrypt.hash(randomBytes(32).toString("hex"), 4), failedLogins: 0, lockedUntil: null,
        },
      });
      return open.length;
    });
    await prisma.$executeRawUnsafe(`DELETE FROM "session" WHERE sess->>'userId' = $1`, old.id).catch(() => undefined);
    await audit(req.user!, "user.delete", { id: old.id, email: old.email, name: old.name, role: old.role, unassignedOpenWorkOrders: unassigned });
    res.json({ ok: true, unassignedOpenWorkOrders: unassigned });
  } catch (e) {
    next(e);
  }
});

// ---------- sections & properties ----------
adminRouter.post("/sections", DH, async (req, res, next) => {
  try {
    const { name } = z.object({ name: z.string().trim().min(1).max(100) }).parse(req.body);
    const n = await prisma.section.count();
    const s = await prisma.section.create({ data: { name, sortOrder: n } });
    await audit(req.user!, "section.create", { name });
    res.status(201).json(s);
  } catch (e) {
    next(e);
  }
});

adminRouter.post("/properties", DH, async (req, res, next) => {
  try {
    const b = z.object({ name: z.string().trim().min(1).max(100), section: z.string().nullable() }).parse(req.body);
    const sec = b.section ? await prisma.section.findUnique({ where: { name: b.section } }) : null;
    const p = await prisma.property.create({ data: { name: b.name, sectionId: sec?.id ?? null } });
    await audit(req.user!, "property.create", b);
    res.status(201).json(p);
  } catch (e) {
    next(e);
  }
});

adminRouter.put("/properties/:id", DH, async (req, res, next) => {
  try {
    const b = z.object({ section: z.string().nullable(), scoreRed: z.number().int().min(0).max(20), scoreAmber: z.number().int().min(0).max(20) }).parse(req.body);
    const sec = b.section ? await prisma.section.findUnique({ where: { name: b.section } }) : null;
    const p = await prisma.property.update({ where: { id: req.params.id }, data: { sectionId: sec?.id ?? null, scoreRed: b.scoreRed, scoreAmber: b.scoreAmber } });
    await audit(req.user!, "property.update", { id: p.id, ...b });
    res.json(p);
  } catch (e) {
    next(e);
  }
});

// ---------- settings ----------
adminRouter.put("/settings/thresholds", DH, async (req, res, next) => {
  try {
    const before = await getThresholds();
    const t = mergeThresholds(req.body);
    await setSetting("thresholds", t);
    await audit(req.user!, "settings.thresholds", { before, after: t });
    res.json(t);
  } catch (e) {
    next(e);
  }
});

adminRouter.put("/settings/as-of", DH, async (req, res, next) => {
  try {
    const { asOf } = z.object({ asOf: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable() }).parse(req.body);
    await setSetting("asOf", asOf);
    await audit(req.user!, "settings.asOf", { asOf });
    res.json({ asOf: await getAsOf() });
  } catch (e) {
    next(e);
  }
});

adminRouter.get("/audit", DH, async (_req, res, next) => {
  try {
    res.json(await prisma.auditLog.findMany({ orderBy: { createdAt: "desc" }, take: 300 }));
  } catch (e) {
    next(e);
  }
});
