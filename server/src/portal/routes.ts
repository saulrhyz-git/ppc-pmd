// Public owner / tenant portal API, mounted at /api/portal.
// Every data query is filtered by the units the signed-in account currently has access to;
// anything outside that answers 404 so the portal never confirms that a record exists.
import express, { Router, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import multer from "multer";
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { z } from "zod";
import type { Prisma, PortalAccount } from "@prisma/client";
import {
  MD, PORTAL_URGENCY, TRADES, passwordProblem, runMeters, useBetween,
  type EngineEvent, type EngineMeter, type EngineReading, type PortalMeDTO, type PortalMeterDTO, type PortalRelation, type PortalRequestDTO, type PortalSessionDTO, type PortalUnitDTO, type PortalUrgency,
} from "@pmd/shared";
import { prisma } from "../db.ts";
import { HttpError } from "../auth.ts";
import { UPLOAD_DIR, nextControlNo } from "../routes/concerns.ts";
import {
  decrypt, encrypt, hashToken, limits, newRecoveryCodes, newTotpSecret, noStore, normRecovery, otpauthUrl, portalCsrf, sniffFile, verifyTotp,
} from "./security.ts";
import { clearCookie, endSession, findSession, mfaRequiredForAll, requireMfaIfMandatory, requirePortal, revokeAll, startSession, sweep } from "./session.ts";

/** Used so a sign-in with an unknown email takes as long as one with a known email. */
const DUMMY_HASH = bcrypt.hashSync(crypto.randomBytes(16).toString("hex"), 12);

export async function portalAudit(a: Pick<PortalAccount, "id" | "email"> | null, action: string, req: Request, detail?: object) {
  await prisma.auditLog.create({ data: { userName: a ? `portal:${a.email}` : "portal", action: `portal.${action}`, detail: { ...(detail ?? {}), ...(a ? { accountId: a.id } : {}), ip: req.ip ?? "" } } });
}

const OPEN_STATUSES = ["Sent", "Received", "In progress"];
const todayUtc = () => new Date(new Date().toISOString().slice(0, 10) + "T00:00:00Z");

/** Units this account may see right now: not revoked, not past the end date, unit still active. */
export async function activeAccess(accountId: string) {
  return prisma.portalUnitAccess.findMany({
    where: { accountId, revokedAt: null, OR: [{ endsOn: null }, { endsOn: { gte: todayUtc() } }], unit: { status: "Active" } },
    include: { unit: { include: { property: true } } },
    orderBy: [{ unit: { property: { name: "asc" } } }, { unit: { code: "asc" } }],
  });
}
type Access = Awaited<ReturnType<typeof activeAccess>>[number];

/** The concerns this account may see, as a Prisma filter. */
function visibleWhere(accountId: string, access: Access[]): Prisma.ConcernWhereInput {
  const all = access.filter((a) => a.seeAllRequests).map((a) => a.unitId);
  const own = access.map((a) => a.unitId);
  return { OR: [{ unitId: { in: all } }, { portalAccountId: accountId, unitId: { in: own } }] };
}

async function me(account: PortalAccount): Promise<PortalMeDTO> {
  const access = await activeAccess(account.id);
  const counts = await prisma.concern.groupBy({ by: ["unitId"], where: { AND: [visibleWhere(account.id, access), { status: { in: OPEN_STATUSES } }] }, _count: true });
  const units: PortalUnitDTO[] = access.map((a) => ({
    accessId: a.id, unitId: a.unitId, code: a.unit.code, kind: a.unit.kind, floor: a.unit.floor,
    building: a.unit.property.name, buildingKind: a.unit.property.kind, relation: a.relation as PortalRelation,
    canRequest: a.canRequest, seeAllRequests: a.seeAllRequests, endsOn: a.endsOn ? a.endsOn.toISOString().slice(0, 10) : null,
    openRequests: counts.find((c) => c.unitId === a.unitId)?._count ?? 0,
  }));
  return { id: account.id, email: account.email, name: account.name, phone: account.phone, mfaEnabled: account.mfaEnabled, mfaRequired: mfaRequiredForAll(), units };
}

// ---------- uploads ----------
const upload = multer({
  storage: multer.diskStorage({ destination: UPLOAD_DIR, filename: (_r, _f, cb) => cb(null, crypto.randomUUID()) }),
  limits: { fileSize: 10 * 1024 * 1024, files: 5, fields: 10, fieldSize: 8 * 1024 },
  fileFilter: (_r, f, cb) => cb(null, /^(image\/(png|jpeg|gif|webp|heic)|application\/pdf)$/.test(f.mimetype)),
});

/** Checks every uploaded file by its content. On any bad file, deletes them all and refuses the request. */
function checkedFiles(req: Request) {
  const files = (req.files as Express.Multer.File[] | undefined) ?? [];
  const types = files.map((f) => sniffFile(f.path));
  if (types.some((t) => !t)) {
    for (const f of files) fs.rm(f.path, { force: true }, () => undefined);
    throw new HttpError(400, "Only photos (JPEG, PNG, GIF, WebP, HEIC) and PDF files can be attached");
  }
  return files.map((f, i) => ({ f, mime: types[i]! }));
}

/** Removes uploaded files when the request fails after multer saved them. */
function dropFiles(req: Request) {
  for (const f of (req.files as Express.Multer.File[] | undefined) ?? []) fs.rm(f.path, { force: true }, () => undefined);
}

async function saveFiles(files: ReturnType<typeof checkedFiles>, ownerType: string, ownerId: string, property: string, accountId: string) {
  for (const { f, mime } of files) {
    const name = f.originalname.replace(/[^\w .()-]/g, "_").slice(0, 120) || "file";
    await prisma.attachment.create({ data: { ownerType, ownerId, filename: name, mime, size: f.size, storedName: f.filename, property, createdById: `portal:${accountId}` } });
  }
}

// ---------- request DTO ----------
const reqInclude = {
  unit: { include: { property: true } },
  portalAccount: { select: { id: true, name: true } },
  updates: { include: { author: { select: { name: true } }, portalAccount: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" as const } },
  workOrders: { select: { ticket: true, title: true, status: true, targetDate: true, completedAt: true }, orderBy: { createdAt: "asc" as const } },
} satisfies Prisma.ConcernInclude;
type ReqFull = Prisma.ConcernGetPayload<{ include: typeof reqInclude }>;

async function requestDTO(c: ReqFull, accountId: string): Promise<PortalRequestDTO> {
  const atts = await prisma.attachment.findMany({ where: { OR: [{ ownerType: "concern", ownerId: c.id }, { ownerType: "update", ownerId: { in: c.updates.map((u) => u.id) } }] }, orderBy: { createdAt: "asc" } });
  const a = (type: string, id: string) => atts.filter((x) => x.ownerType === type && x.ownerId === id).map((x) => ({ id: x.id, filename: x.filename, mime: x.mime, size: x.size }));
  const who = (p: { id: string; name: string } | null) => (p ? (p.id === accountId ? "You" : p.name) : "Property management");
  return {
    id: c.id, controlNo: c.controlNo, unitId: c.unitId, unitCode: c.unit?.code ?? "", building: c.unit?.property.name ?? c.property,
    trade: c.trade, location: c.location, concern: c.concern, urgency: (c.urgency as PortalUrgency) || "Normal", status: c.status,
    createdAt: c.createdAt.toISOString(), filedBy: who(c.portalAccount), mine: c.portalAccountId === accountId,
    updates: c.updates.map((u) => ({
      id: u.id, kind: u.kind as "followup", message: u.message, authorName: u.portalAccount ? who(u.portalAccount) : "Property management",
      mine: u.portalAccountId === accountId, createdAt: u.createdAt.toISOString(), attachments: a("update", u.id),
    })),
    attachments: a("concern", c.id),
    workOrders: c.workOrders.map((w) => ({ ticket: w.ticket, title: w.title, status: w.status, targetDate: w.targetDate.toISOString().slice(0, 10), completedAt: w.completedAt?.toISOString() ?? null })),
  };
}

async function loadRequest(req: Request, id: string) {
  const acct = req.portal!.account;
  const access = await activeAccess(acct.id);
  const c = await prisma.concern.findFirst({ where: { AND: [{ id }, visibleWhere(acct.id, access)] }, include: reqInclude });
  if (!c) throw new HttpError(404, "Request not found");
  return { c, access: access.find((a) => a.unitId === c.unitId)! };
}

// ======================================================================
// Router
// ======================================================================
export const portalRouter = Router();
portalRouter.use(noStore, limits.global, express.json({ limit: "32kb" }), portalCsrf);

// Housekeeping: drop long-expired sessions and links about once an hour.
let lastSweep = 0;
portalRouter.use((_req, _res, next) => {
  if (Date.now() - lastSweep > 3_600_000) { lastSweep = Date.now(); sweep().catch((e) => console.error("portal sweep", e)); }
  next();
});

// ---------- sign-in ----------
const auth = Router();
portalRouter.use("/auth", auth);

const email = z.string().trim().toLowerCase().email().max(254);

/** Lockout grows with repeated failures: 15 min after 5, 1 hour after 10, 24 hours after 15. */
const lockFor = (fails: number) => (fails >= 15 ? 24 * 60 : fails >= 10 ? 60 : fails >= 5 ? 15 : 0);
const BAD_LOGIN = "Email or password is wrong. After several wrong tries the account is locked for a while.";

auth.post("/login", limits.loginIp, limits.loginEmail, async (req, res, next) => {
  try {
    const b = z.object({ email, password: z.string().min(1).max(200) }).parse(req.body);
    const a = await prisma.portalAccount.findUnique({ where: { email: b.email } });
    const usable = a && a.active && a.passwordHash && !(a.lockedUntil && a.lockedUntil > new Date());
    const ok = await bcrypt.compare(b.password, usable ? a.passwordHash! : DUMMY_HASH);
    if (!a || !usable || !ok) {
      if (a && usable) {
        const fails = a.failedLogins + 1;
        const min = lockFor(fails);
        await prisma.portalAccount.update({ where: { id: a.id }, data: { failedLogins: fails, lockedUntil: min && fails % 5 === 0 ? new Date(Date.now() + min * 60_000) : a.lockedUntil } });
      }
      await portalAudit(a, "login.failed", req, { email: b.email });
      throw new HttpError(401, BAD_LOGIN);
    }
    await prisma.portalAccount.update({ where: { id: a.id }, data: { failedLogins: 0, lockedUntil: null } });
    await endSession(req, res); // never reuse a cookie from before sign-in
    if (a.mfaEnabled) {
      await startSession(req, res, a.id, true);
      return res.json({ state: "mfa" });
    }
    await startSession(req, res, a.id, false);
    await prisma.portalAccount.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
    await portalAudit(a, "login", req);
    res.json({ state: "ok", me: await me(a) });
  } catch (e) {
    next(e);
  }
});

/** Second step: a 6-digit code from the authenticator app, or a recovery code. */
auth.post("/mfa", limits.mfa, async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().trim().min(6).max(20) }).parse(req.body);
    const s = await findSession(req);
    if (!s || !s.mfaPending) { clearCookie(res); throw new HttpError(401, "Your sign-in timed out. Please start again."); }
    const a = s.account;
    let step: number | null = null, usedRecovery = false;
    if (/^\d{6}$/.test(code) && a.mfaSecret) step = verifyTotp(decrypt(a.mfaSecret), code, a.mfaLastStep);
    else {
      const h = hashToken(normRecovery(code));
      usedRecovery = a.recoveryCodes.includes(h);
    }
    if (step == null && !usedRecovery) {
      const fails = s.mfaFails + 1;
      await prisma.portalSession.update({ where: { id: s.id }, data: { mfaFails: fails, ...(fails >= 5 ? { revokedAt: new Date() } : {}) } });
      await portalAudit(a, "mfa.failed", req);
      if (fails >= 5) { clearCookie(res); throw new HttpError(401, "Too many wrong codes. Please sign in again."); }
      throw new HttpError(400, "That code is not right. Check the time on your phone and try again.");
    }
    await prisma.portalSession.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    const updated = await prisma.portalAccount.update({
      where: { id: a.id },
      data: { lastLoginAt: new Date(), ...(step != null ? { mfaLastStep: step } : {}), ...(usedRecovery ? { recoveryCodes: a.recoveryCodes.filter((x) => x !== hashToken(normRecovery(code))) } : {}) },
    });
    await startSession(req, res, a.id, false);
    await portalAudit(a, usedRecovery ? "login.recovery-code" : "login", req);
    res.json({ state: "ok", me: await me(updated), recoveryCodesLeft: updated.recoveryCodes.length });
  } catch (e) {
    next(e);
  }
});

auth.post("/logout", async (req, res, next) => {
  try {
    await endSession(req, res);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** Lets the app know on start-up whether it is signed in, half-way (code needed) or signed out. */
auth.get("/state", async (req, res, next) => {
  try {
    const s = await findSession(req);
    if (!s) return res.json({ state: "none" });
    if (s.mfaPending) return res.json({ state: "mfa" });
    res.json({ state: "ok", me: await me(s.account) });
  } catch (e) {
    next(e);
  }
});

// ---------- invitation and reset links ----------
const tokenBody = z.object({ token: z.string().min(20).max(100) });

async function findToken(token: string) {
  const t = await prisma.portalToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { account: true } });
  if (!t || t.usedAt || t.expiresAt <= new Date() || !t.account.active) throw new HttpError(400, "This link has expired or was already used. Ask property management for a new one.");
  return t;
}

auth.post("/link/check", limits.token, async (req, res, next) => {
  try {
    const t = await findToken(tokenBody.parse(req.body).token);
    res.json({ purpose: t.purpose, email: t.account.email, name: t.account.name });
  } catch (e) {
    next(e);
  }
});

auth.post("/link/use", limits.token, async (req, res, next) => {
  try {
    const b = tokenBody.extend({ password: z.string().max(200), name: z.string().trim().min(1).max(200).optional() }).parse(req.body);
    const t = await findToken(b.token);
    const name = b.name ?? t.account.name;
    const problem = passwordProblem(b.password, t.account.email, name);
    if (problem) throw new HttpError(400, problem);
    // Mark used first, guarded on usedAt, so two simultaneous uses cannot both succeed.
    const claimed = await prisma.portalToken.updateMany({ where: { id: t.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new HttpError(400, "This link was already used.");
    const a = await prisma.portalAccount.update({
      where: { id: t.accountId },
      data: { passwordHash: await bcrypt.hash(b.password, 12), passwordChangedAt: new Date(), name, failedLogins: 0, lockedUntil: null },
    });
    await prisma.portalToken.updateMany({ where: { accountId: a.id, usedAt: null }, data: { usedAt: new Date() } });
    await revokeAll(a.id);
    await endSession(req, res);
    await portalAudit(a, t.purpose === "invite" ? "invite.accepted" : "password.reset", req);
    // A reset link proves control of the link only, so two-step sign-in still applies.
    if (a.mfaEnabled) {
      await startSession(req, res, a.id, true);
      return res.json({ state: "mfa" });
    }
    await startSession(req, res, a.id, false);
    await prisma.portalAccount.update({ where: { id: a.id }, data: { lastLoginAt: new Date() } });
    res.json({ state: "ok", me: await me(a) });
  } catch (e) {
    next(e);
  }
});

// ---------- signed in from here on ----------
portalRouter.use(requirePortal);

portalRouter.get("/me", async (req, res, next) => {
  try {
    res.json(await me(req.portal!.account));
  } catch (e) {
    next(e);
  }
});

// ---------- my account ----------
const account = Router();
portalRouter.use("/account", account);

async function checkPassword(a: PortalAccount, pw: string) {
  if (!a.passwordHash || !(await bcrypt.compare(pw, a.passwordHash))) throw new HttpError(400, "Your current password is wrong");
}

account.patch("/profile", async (req, res, next) => {
  try {
    const b = z.object({ name: z.string().trim().min(1).max(200), phone: z.string().trim().max(40).regex(/^[0-9 +()-]*$/, "Use digits, spaces, + ( ) and - only") }).parse(req.body);
    const a = await prisma.portalAccount.update({ where: { id: req.portal!.account.id }, data: b });
    await portalAudit(a, "profile.update", req);
    res.json(await me(a));
  } catch (e) {
    next(e);
  }
});

account.post("/password", limits.mfa, async (req, res, next) => {
  try {
    const b = z.object({ current: z.string().max(200), next: z.string().max(200) }).parse(req.body);
    const a = req.portal!.account;
    await checkPassword(a, b.current);
    const problem = passwordProblem(b.next, a.email, a.name);
    if (problem) throw new HttpError(400, problem);
    if (await bcrypt.compare(b.next, a.passwordHash!)) throw new HttpError(400, "Choose a password you have not used here before");
    await prisma.portalAccount.update({ where: { id: a.id }, data: { passwordHash: await bcrypt.hash(b.next, 12), passwordChangedAt: new Date() } });
    await revokeAll(a.id, req.portal!.session.id);
    await portalAudit(a, "password.change", req);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** Starts two-step sign-in set-up: a new secret, not active until a code from it is confirmed. */
account.post("/mfa/setup", limits.mfa, async (req, res, next) => {
  try {
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
    const a = req.portal!.account;
    await checkPassword(a, password);
    if (a.mfaEnabled) throw new HttpError(400, "Two-step sign-in is already on");
    const secret = newTotpSecret();
    await prisma.portalAccount.update({ where: { id: a.id }, data: { mfaSecret: encrypt(secret), mfaLastStep: null } });
    res.json({ secret, otpauthUrl: otpauthUrl(secret, a.email) });
  } catch (e) {
    next(e);
  }
});

account.post("/mfa/enable", limits.mfa, async (req, res, next) => {
  try {
    const { code } = z.object({ code: z.string().trim() }).parse(req.body);
    const a = req.portal!.account;
    if (a.mfaEnabled || !a.mfaSecret) throw new HttpError(400, "Start the set-up again");
    const step = verifyTotp(decrypt(a.mfaSecret), code, null);
    if (step == null) throw new HttpError(400, "That code is not right. Check the time on your phone and try again.");
    const codes = newRecoveryCodes();
    await prisma.portalAccount.update({ where: { id: a.id }, data: { mfaEnabled: true, mfaLastStep: step, recoveryCodes: codes.map((c) => hashToken(normRecovery(c))) } });
    await revokeAll(a.id, req.portal!.session.id);
    await portalAudit(a, "mfa.enable", req);
    res.json({ recoveryCodes: codes });
  } catch (e) {
    next(e);
  }
});

account.post("/mfa/disable", limits.mfa, async (req, res, next) => {
  try {
    const b = z.object({ password: z.string().max(200), code: z.string().trim() }).parse(req.body);
    const a = req.portal!.account;
    if (mfaRequiredForAll()) throw new HttpError(400, "Two-step sign-in is required for every portal account");
    if (!a.mfaEnabled || !a.mfaSecret) throw new HttpError(400, "Two-step sign-in is not on");
    await checkPassword(a, b.password);
    const step = verifyTotp(decrypt(a.mfaSecret), b.code, a.mfaLastStep);
    if (step == null) throw new HttpError(400, "That code is not right");
    await prisma.portalAccount.update({ where: { id: a.id }, data: { mfaEnabled: false, mfaSecret: null, mfaLastStep: null, recoveryCodes: [] } });
    await portalAudit(a, "mfa.disable", req);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

account.post("/mfa/recovery-codes", limits.mfa, async (req, res, next) => {
  try {
    const { password } = z.object({ password: z.string().max(200) }).parse(req.body);
    const a = req.portal!.account;
    await checkPassword(a, password);
    if (!a.mfaEnabled) throw new HttpError(400, "Two-step sign-in is not on");
    const codes = newRecoveryCodes();
    await prisma.portalAccount.update({ where: { id: a.id }, data: { recoveryCodes: codes.map((c) => hashToken(normRecovery(c))) } });
    await portalAudit(a, "mfa.recovery-codes", req);
    res.json({ recoveryCodes: codes });
  } catch (e) {
    next(e);
  }
});

account.get("/sessions", async (req, res, next) => {
  try {
    const list = await prisma.portalSession.findMany({ where: { accountId: req.portal!.account.id, revokedAt: null, mfaPending: false, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
    res.json(list.map((s): PortalSessionDTO => ({ id: s.id, current: s.id === req.portal!.session.id, ip: s.ip, userAgent: s.userAgent, createdAt: s.createdAt.toISOString(), lastSeenAt: s.lastSeenAt.toISOString() })));
  } catch (e) {
    next(e);
  }
});

account.post("/sessions/revoke-others", async (req, res, next) => {
  try {
    await revokeAll(req.portal!.account.id, req.portal!.session.id);
    await portalAudit(req.portal!.account, "sessions.revoke-others", req);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- units and requests (two-step sign-in may be required first) ----------
const data = Router();
portalRouter.use(requireMfaIfMandatory, data);

// ---------- meters: read-only, only the unit's own meters ----------
const PORTAL_MONTHS = 6;
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

data.get("/meters", async (req, res, next) => {
  try {
    const access = await activeAccess(req.portal!.account.id);
    const today = localToday();
    // Only "Tenant" class meters linked to a unit the person can see now. Common area and utility
    // main meters are never shown, even if someone links one to a unit.
    const meters = await prisma.meter.findMany({
      where: { unitId: { in: access.map((a) => a.unitId) }, meterClass: "Tenant", activeFrom: { lte: new Date(today) } },
      include: { unit: { include: { property: true } } },
      orderBy: { code: "asc" },
    });
    if (!meters.length) return res.json([]);
    const month = today.slice(0, 7);
    const months = [month];
    while (months.length < PORTAL_MONTHS) months.unshift(MD.prevMonth(months[0]));
    const from = MD.monthRange(months[0])[0];
    const histFrom = MD.add(from, -45); // a starting reading before the first month
    const ids = meters.map((m) => m.id);
    const [rows, evs] = await Promise.all([
      prisma.meterReading.findMany({ where: { meterId: { in: ids }, voidedAt: null, readingDate: { gte: new Date(histFrom), lte: new Date(today) } }, select: { id: true, meterId: true, readingDate: true, value: true } }),
      prisma.meterEvent.findMany({ where: { meterId: { in: ids }, date: { gte: new Date(histFrom), lte: new Date(today) } }, select: { meterId: true, date: true, type: true, prevReading: true, newReading: true } }),
    ]);
    const readings: EngineReading[] = rows.map((r) => ({ id: r.id, meterId: r.meterId, date: isoDay(r.readingDate), value: Number(r.value) }));
    const events: EngineEvent[] = evs.map((e) => ({ meterId: e.meterId, date: isoDay(e.date), type: e.type, prevReading: e.prevReading == null ? null : Number(e.prevReading), newReading: e.newReading == null ? null : Number(e.newReading) }));
    const em: EngineMeter[] = meters.map((m) => ({
      id: m.id, code: m.code, meterClass: "Tenant", multiplier: Number(m.multiplier), rolloverAt: m.rolloverAt == null ? null : Number(m.rolloverAt),
      expectedDaily: m.expectedDaily, activeFrom: isoDay(m.activeFrom), activeTo: m.activeTo ? isoDay(m.activeTo) : null, propertyId: m.propertyId,
    }));
    const run = runMeters(em, readings, events, { from, to: today });
    const out: PortalMeterDTO[] = meters.map((m) => {
      const r = run.meters[m.id];
      const lastDate = r.last?.date ?? today;
      const [ms] = MD.monthRange(month);
      const [ps] = MD.monthRange(MD.prevMonth(month));
      const mtd = lastDate >= ms ? useBetween(r, ms, lastDate).use : 0;
      const same = lastDate >= ms ? useBetween(r, ps, MD.add(ps, MD.diff(ms, lastDate))).use : 0;
      const byReading = new Map(r.intervals.filter((iv) => iv.counted).map((iv) => [iv.readingId, iv]));
      const recent = readings.filter((x) => x.meterId === m.id && x.date >= from).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14)
        .map((x) => { const iv = byReading.get(x.id); return { date: x.date, value: x.value, use: iv ? iv.use : null, days: iv ? iv.days : null }; });
      return {
        id: m.id, code: m.code, unitId: m.unitId!, unitCode: m.unit!.code, building: m.unit!.property.name,
        utility: m.utility, unitOfMeasure: m.unitOfMeasure, location: m.location,
        last: r.last, monthToDate: mtd, lastMonthSameDays: same,
        changePct: same > 0 ? Math.round(((mtd - same) / same) * 1000) / 10 : null,
        months: months.map((mo) => {
          const [a, b] = MD.monthRange(mo);
          // null = no readings cover that month (meter not read yet), which is different from zero use.
          const covered = r.intervals.some((iv) => iv.counted && iv.date >= a && iv.prevDate < b);
          const u = useBetween(r, a, b < today ? b : today);
          return { month: mo, use: covered ? u.use : null, estimatedDays: u.estimatedDays };
        }),
        recent,
      };
    });
    res.json(out);
  } catch (e) {
    next(e);
  }
});

data.get("/requests", async (req, res, next) => {
  try {
    const q = z.object({ unitId: z.string().max(40).optional(), status: z.enum(["open", "all"]).default("all") }).parse(req.query);
    const acct = req.portal!.account;
    const access = await activeAccess(acct.id);
    const where: Prisma.ConcernWhereInput = { AND: [visibleWhere(acct.id, access), ...(q.unitId ? [{ unitId: q.unitId }] : []), ...(q.status === "open" ? [{ status: { in: OPEN_STATUSES } }] : [])] };
    const list = await prisma.concern.findMany({ where, include: reqInclude, orderBy: { createdAt: "desc" }, take: 200 });
    res.json(await Promise.all(list.map((c) => requestDTO(c, acct.id))));
  } catch (e) {
    next(e);
  }
});

data.get("/requests/:id", async (req, res, next) => {
  try {
    res.json(await requestDTO((await loadRequest(req, req.params.id)).c, req.portal!.account.id));
  } catch (e) {
    next(e);
  }
});

data.post("/requests", limits.newRequest, upload.array("files", 5), async (req, res, next) => {
  try {
    const acct = req.portal!.account;
    const b = z.object({
      unitId: z.string().min(1).max(40),
      trade: z.enum(TRADES),
      location: z.string().trim().max(200).default(""),
      concern: z.string().trim().min(5, "Describe the problem in a few words").max(4000),
      urgency: z.enum(PORTAL_URGENCY).default("Normal"),
    }).parse(req.body);
    const access = (await activeAccess(acct.id)).find((a) => a.unitId === b.unitId);
    if (!access) throw new HttpError(404, "Unit not found");
    if (!access.canRequest) throw new HttpError(403, "Your access to this unit does not include filing requests. Contact property management.");
    const files = checkedFiles(req);
    const u = access.unit;
    const location = [`Unit ${u.code}`, u.floor && `Floor ${u.floor}`, b.location].filter(Boolean).join(" · ");
    const data = { property: u.property.name, unitId: u.id, portalAccountId: acct.id, urgency: b.urgency, tenantName: `${acct.name} (${access.relation})`, trade: b.trade, location, concern: b.concern };
    let c;
    for (let attempt = 0; ; attempt++) {
      try {
        c = await prisma.concern.create({ data: { ...data, controlNo: await nextControlNo() } });
        break;
      } catch (err) {
        // Two requests filed at the same moment can pick the same control number; try the next one.
        if (attempt < 4 && (err as { code?: string }).code === "P2002") continue;
        throw err;
      }
    }
    await saveFiles(files, "concern", c.id, c.property, acct.id);
    await portalAudit(acct, "request.create", req, { id: c.id, controlNo: c.controlNo, unitId: u.id });
    res.status(201).json(await requestDTO((await loadRequest(req, c.id)).c, acct.id));
  } catch (e) {
    dropFiles(req);
    next(e);
  }
});

data.post("/requests/:id/followups", limits.followup, upload.array("files", 5), async (req, res, next) => {
  try {
    const acct = req.portal!.account;
    const { c, access } = await loadRequest(req, req.params.id);
    if (!access.canRequest) throw new HttpError(403, "Your access to this unit does not include sending messages");
    if (c.status === "Closed") throw new HttpError(400, "This request is closed. File a new request if the problem is back.");
    const { message } = z.object({ message: z.string().trim().min(1).max(4000) }).parse(req.body);
    const files = checkedFiles(req);
    const upd = await prisma.concernUpdate.create({ data: { concernId: c.id, kind: "followup", message, portalAccountId: acct.id } });
    await saveFiles(files, "update", upd.id, c.property, acct.id);
    await portalAudit(acct, "request.followup", req, { id: c.id });
    res.status(201).json(await requestDTO((await loadRequest(req, c.id)).c, acct.id));
  } catch (e) {
    dropFiles(req);
    next(e);
  }
});

data.get("/attachments/:id", async (req: Request, res: Response, next) => {
  try {
    const a = await prisma.attachment.findUnique({ where: { id: z.string().max(40).parse(req.params.id) } });
    if (!a) throw new HttpError(404, "File not found");
    const concernId = a.ownerType === "concern" ? a.ownerId : a.ownerType === "update" ? (await prisma.concernUpdate.findUnique({ where: { id: a.ownerId } }))?.concernId : null;
    if (!concernId) throw new HttpError(404, "File not found");
    await loadRequest(req, concernId); // permission check: 404 unless visible to this account
    const safeName = a.filename.replace(/[^\w .()-]/g, "_");
    const inline = /^image\/(png|jpeg|gif|webp)$/.test(a.mime);
    res.setHeader("Content-Type", a.mime);
    res.setHeader("Content-Disposition", `${inline ? "inline" : "attachment"}; filename="${safeName}"`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Security-Policy", "default-src 'none'; img-src 'self'; sandbox");
    res.sendFile(path.join(UPLOAD_DIR, path.basename(a.storedName)));
  } catch (e) {
    next(e);
  }
});

portalRouter.use((_req, _res, next) => next(new HttpError(404, "Not found")));
