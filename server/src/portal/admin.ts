// Staff side of the portal, mounted at /api/portal-admin behind the normal staff sign-in.
// Staff invite people to units in their own buildings, change or revoke that access, and help with
// lost passwords or phones. Links are shown once to the staff member; only their hashes are kept.
import { Router, type Request } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { PORTAL_RELATIONS, type PortalAccountAdminDTO, type PortalLinkDTO } from "@pmd/shared";
import { prisma, audit, scopeOf } from "../db.ts";
import { HttpError, requireTab, staffOnly } from "../auth.ts";
import { hashToken, randomToken } from "./security.ts";
import { revokeAll } from "./session.ts";

export const portalAdminRouter = Router();
portalAdminRouter.use(staffOnly, requireTab("prt", 1));
const canWrite = requireTab("prt", 2);

const INVITE_HOURS = Number(process.env.PORTAL_INVITE_HOURS || 72);
const RESET_HOURS = Number(process.env.PORTAL_RESET_HOURS || 24);
const seesEverything = (req: Request) => req.user!.role === "Department Head" || req.user!.role === "General Manager";

const accountInclude = { access: { include: { unit: { include: { property: true } } }, orderBy: { createdAt: "asc" as const } } } satisfies Prisma.PortalAccountInclude;
type AccountFull = Prisma.PortalAccountGetPayload<{ include: typeof accountInclude }>;

function toDTO(a: AccountFull, scope: Set<string>): PortalAccountAdminDTO {
  const locked = !!(a.lockedUntil && a.lockedUntil > new Date());
  return {
    id: a.id, email: a.email, name: a.name, phone: a.phone,
    state: !a.active ? "Disabled" : !a.passwordHash ? "Invited" : locked ? "Locked" : "Active",
    mfaEnabled: a.mfaEnabled, lastLoginAt: a.lastLoginAt?.toISOString() ?? null, createdAt: a.createdAt.toISOString(),
    // Staff only see access rows for units in their own buildings.
    access: a.access.filter((x) => scope.has(x.unit.property.name)).map((x) => ({
      id: x.id, unitId: x.unitId, unitCode: x.unit.code, building: x.unit.property.name, relation: x.relation as PortalAccountAdminDTO["access"][number]["relation"],
      canRequest: x.canRequest, seeAllRequests: x.seeAllRequests, endsOn: x.endsOn ? x.endsOn.toISOString().slice(0, 10) : null,
      revokedAt: x.revokedAt?.toISOString() ?? null, grantedByName: x.grantedByName, createdAt: x.createdAt.toISOString(),
    })),
  };
}

async function scopeSet(req: Request) {
  return new Set(await scopeOf(req.user!));
}

/** Loads an account the staff member may manage: one with access to a unit in their buildings (DH/GM: any). */
async function loadAccount(req: Request, id: string) {
  const a = await prisma.portalAccount.findUnique({ where: { id }, include: accountInclude });
  const scope = await scopeSet(req);
  if (!a || (!seesEverything(req) && !a.access.some((x) => scope.has(x.unit.property.name)))) throw new HttpError(404, "Portal account not found");
  return { a, scope };
}

async function loadAccess(req: Request, id: string) {
  const x = await prisma.portalUnitAccess.findUnique({ where: { id }, include: { unit: { include: { property: true } }, account: true } });
  if (!x || !(await scopeOf(req.user!)).includes(x.unit.property.name)) throw new HttpError(404, "Access not found");
  return x;
}

async function loadUnit(req: Request, unitId: string) {
  const u = await prisma.unit.findUnique({ where: { id: unitId }, include: { property: true } });
  if (!u || !(await scopeOf(req.user!)).includes(u.property.name)) throw new HttpError(404, "Unit not found");
  return u;
}

function baseUrl(req: Request) {
  const env = process.env.PORTAL_PUBLIC_URL;
  if (env) return env.replace(/\/+$/, "");
  return `${req.protocol}://${req.get("host")}`;
}

/** Makes a new single-use link and cancels any older unused ones for the account. */
async function issueLink(req: Request, accountId: string, purpose: "invite" | "reset"): Promise<PortalLinkDTO> {
  await prisma.portalToken.updateMany({ where: { accountId, usedAt: null }, data: { usedAt: new Date() } });
  const token = randomToken();
  const expiresAt = new Date(Date.now() + (purpose === "invite" ? INVITE_HOURS : RESET_HOURS) * 3_600_000);
  await prisma.portalToken.create({ data: { accountId, purpose, tokenHash: hashToken(token), expiresAt, createdById: req.user!.id } });
  // The token goes after "#", so browsers never send it to the server in the URL, logs or Referer.
  return { url: `${baseUrl(req)}/portal/welcome#t=${token}`, expiresAt: expiresAt.toISOString() };
}

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-12-31");
const accessFields = {
  relation: z.enum(PORTAL_RELATIONS),
  canRequest: z.boolean().default(true),
  seeAllRequests: z.boolean().optional(),
  endsOn: day.nullable().optional(),
};

// ---------- read ----------
portalAdminRouter.get("/units", async (req, res, next) => {
  try {
    const q = z.object({ property: z.string().optional() }).parse(req.query);
    const scope = await scopeOf(req.user!);
    if (q.property && !scope.includes(q.property)) throw new HttpError(403, "Not your building");
    const units = await prisma.unit.findMany({
      where: { property: { name: q.property ? q.property : { in: scope } } },
      include: { property: true, _count: { select: { portalAccess: { where: { revokedAt: null } } } } },
      orderBy: [{ property: { name: "asc" } }, { code: "asc" }],
    });
    res.json(units.map((u) => ({ id: u.id, code: u.code, kind: u.kind, floor: u.floor, building: u.property.name, occupancy: u.occupancy, ownerName: u.ownerName, tenantName: u.tenantName, status: u.status, portalAccounts: u._count.portalAccess })));
  } catch (e) {
    next(e);
  }
});

portalAdminRouter.get("/accounts", async (req, res, next) => {
  try {
    const q = z.object({ unitId: z.string().optional(), property: z.string().optional(), q: z.string().max(200).optional() }).parse(req.query);
    const scope = await scopeSet(req);
    const props = q.property ? (scope.has(q.property) ? [q.property] : []) : [...scope];
    const unitFilter: Prisma.UnitWhereInput = { property: { name: { in: props } }, ...(q.unitId ? { id: q.unitId } : {}) };
    const where: Prisma.PortalAccountWhereInput = {
      AND: [
        seesEverything(req) && !q.unitId && !q.property ? {} : { access: { some: { unit: unitFilter } } },
        q.q ? { OR: [{ email: { contains: q.q, mode: "insensitive" } }, { name: { contains: q.q, mode: "insensitive" } }] } : {},
      ],
    };
    const list = await prisma.portalAccount.findMany({ where, include: accountInclude, orderBy: { name: "asc" }, take: 500 });
    res.json(list.map((a) => toDTO(a, scope)));
  } catch (e) {
    next(e);
  }
});

// ---------- invite ----------
portalAdminRouter.post("/invite", canWrite, async (req, res, next) => {
  try {
    const b = z.object({
      email: z.string().trim().toLowerCase().email().max(254),
      name: z.string().trim().min(1).max(200),
      phone: z.string().trim().max(40).default(""),
      unitId: z.string().min(1),
      ...accessFields,
    }).parse(req.body);
    const unit = await loadUnit(req, b.unitId);
    const u = req.user!;
    let a = await prisma.portalAccount.findUnique({ where: { email: b.email } });
    if (a && !a.active) throw new HttpError(400, "That portal account is disabled. Enable it first.");
    if (!a) a = await prisma.portalAccount.create({ data: { email: b.email, name: b.name, phone: b.phone, createdById: u.id } });
    const seeAll = b.seeAllRequests ?? b.relation === "Owner";
    const endsOn = b.endsOn ? new Date(b.endsOn + "T00:00:00Z") : null;
    await prisma.portalUnitAccess.upsert({
      where: { accountId_unitId: { accountId: a.id, unitId: unit.id } },
      create: { accountId: a.id, unitId: unit.id, relation: b.relation, canRequest: b.canRequest, seeAllRequests: seeAll, endsOn, grantedById: u.id, grantedByName: u.name },
      update: { relation: b.relation, canRequest: b.canRequest, seeAllRequests: seeAll, endsOn, revokedAt: null, grantedById: u.id, grantedByName: u.name },
    });
    // People who already set a password just get the new unit; new people get a link.
    const link = a.passwordHash ? null : await issueLink(req, a.id, "invite");
    await audit(u, "portal.invite", { accountId: a.id, email: a.email, unit: `${unit.property.name} ${unit.code}`, relation: b.relation, linkIssued: !!link });
    const { a: full, scope } = await loadAccount(req, a.id);
    res.status(201).json({ account: toDTO(full, scope), link });
  } catch (e) {
    next(e);
  }
});

/** A fresh invitation link (no password yet) or a password reset link. */
portalAdminRouter.post("/accounts/:id/link", canWrite, async (req, res, next) => {
  try {
    const { a } = await loadAccount(req, req.params.id);
    if (!a.active) throw new HttpError(400, "Enable the account first");
    const purpose = a.passwordHash ? "reset" : "invite";
    const link = await issueLink(req, a.id, purpose);
    await audit(req.user!, `portal.${purpose}-link`, { accountId: a.id, email: a.email });
    res.json({ purpose, link });
  } catch (e) {
    next(e);
  }
});

portalAdminRouter.patch("/accounts/:id", canWrite, async (req, res, next) => {
  try {
    const b = z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().max(40) }).parse(req.body);
    const { a } = await loadAccount(req, req.params.id);
    await prisma.portalAccount.update({ where: { id: a.id }, data: b });
    await audit(req.user!, "portal.account.update", { accountId: a.id });
    const r = await loadAccount(req, a.id);
    res.json(toDTO(r.a, r.scope));
  } catch (e) {
    next(e);
  }
});

const accountAction = (name: string, run: (id: string) => Promise<unknown>) =>
  portalAdminRouter.post(`/accounts/:id/${name}`, canWrite, async (req, res, next) => {
    try {
      const { a } = await loadAccount(req, req.params.id);
      await run(a.id);
      await audit(req.user!, `portal.account.${name}`, { accountId: a.id, email: a.email });
      const r = await loadAccount(req, a.id);
      res.json(toDTO(r.a, r.scope));
    } catch (e) {
      next(e);
    }
  });

accountAction("disable", async (id) => {
  await prisma.portalAccount.update({ where: { id }, data: { active: false } });
  await prisma.portalToken.updateMany({ where: { accountId: id, usedAt: null }, data: { usedAt: new Date() } });
  await revokeAll(id);
});
accountAction("enable", (id) => prisma.portalAccount.update({ where: { id }, data: { active: true, failedLogins: 0, lockedUntil: null } }));
accountAction("unlock", (id) => prisma.portalAccount.update({ where: { id }, data: { failedLogins: 0, lockedUntil: null } }));
accountAction("sign-out", (id) => revokeAll(id));
/** For a lost phone: turns two-step sign-in off so the person can set it up again. */
accountAction("reset-mfa", async (id) => {
  await prisma.portalAccount.update({ where: { id }, data: { mfaEnabled: false, mfaSecret: null, mfaLastStep: null, recoveryCodes: [] } });
  await revokeAll(id);
});

// ---------- unit access ----------
portalAdminRouter.patch("/access/:id", canWrite, async (req, res, next) => {
  try {
    const b = z.object({ relation: accessFields.relation, canRequest: z.boolean(), seeAllRequests: z.boolean(), endsOn: day.nullable() }).parse(req.body);
    const x = await loadAccess(req, req.params.id);
    await prisma.portalUnitAccess.update({ where: { id: x.id }, data: { ...b, endsOn: b.endsOn ? new Date(b.endsOn + "T00:00:00Z") : null } });
    await audit(req.user!, "portal.access.update", { accessId: x.id, accountId: x.accountId, unit: `${x.unit.property.name} ${x.unit.code}`, ...b });
    const r = await loadAccount(req, x.accountId);
    res.json(toDTO(r.a, r.scope));
  } catch (e) {
    next(e);
  }
});

for (const name of ["revoke", "restore"] as const) {
  portalAdminRouter.post(`/access/:id/${name}`, canWrite, async (req, res, next) => {
    try {
      const x = await loadAccess(req, req.params.id);
      await prisma.portalUnitAccess.update({ where: { id: x.id }, data: { revokedAt: name === "revoke" ? new Date() : null } });
      await audit(req.user!, `portal.access.${name}`, { accessId: x.id, accountId: x.accountId, unit: `${x.unit.property.name} ${x.unit.code}` });
      const r = await prisma.portalAccount.findUniqueOrThrow({ where: { id: x.accountId }, include: accountInclude });
      res.json(toDTO(r, await scopeSet(req)));
    } catch (e) {
      next(e);
    }
  });
}
