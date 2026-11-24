// Portal sign-in sessions. Separate from staff sessions: own cookie, own table, own timeouts.
import type { NextFunction, Request, Response } from "express";
import type { PortalAccount, PortalSession } from "@prisma/client";
import { prisma } from "../db.ts";
import { HttpError } from "../auth.ts";
import { describeAgent, hashToken, randomToken } from "./security.ts";

export const COOKIE = "ppc_portal";
/** Signed out after this long without activity. */
export const IDLE_MS = Number(process.env.PORTAL_IDLE_MINUTES || 30) * 60_000;
/** Signed out after this long no matter what. */
export const ABSOLUTE_MS = Number(process.env.PORTAL_MAX_HOURS || 12) * 3_600_000;
/** Time allowed between the password and the two-step code. */
const MFA_PENDING_MS = 5 * 60_000;

export const mfaRequiredForAll = () => process.env.PORTAL_REQUIRE_MFA === "1";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      portal?: { account: PortalAccount; session: PortalSession };
    }
  }
}

function readCookie(req: Request, name: string) {
  const raw = req.headers.cookie;
  if (!raw) return null;
  for (const part of raw.split(";")) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i).trim() === name) return decodeURIComponent(part.slice(i + 1).trim());
  }
  return null;
}

function setCookie(res: Response, value: string, maxAgeMs: number) {
  const secure = process.env.COOKIE_SECURE === "1";
  const parts = [`${COOKIE}=${value}`, "Path=/api/portal", "HttpOnly", "SameSite=Strict", `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (secure) parts.push("Secure");
  res.append("Set-Cookie", parts.join("; "));
}

export const clearCookie = (res: Response) => setCookie(res, "", 0);

/** Starts a new session (always a fresh token, so a planted cookie can never be upgraded). */
export async function startSession(req: Request, res: Response, accountId: string, mfaPending: boolean) {
  const token = randomToken();
  const now = Date.now();
  const s = await prisma.portalSession.create({
    data: {
      accountId, tokenHash: hashToken(token), mfaPending,
      ip: (req.ip ?? "").slice(0, 64), userAgent: describeAgent(req.get("user-agent") ?? ""),
      expiresAt: new Date(now + (mfaPending ? MFA_PENDING_MS : ABSOLUTE_MS)),
    },
  });
  setCookie(res, token, mfaPending ? MFA_PENDING_MS : ABSOLUTE_MS);
  return s;
}

export async function endSession(req: Request, res: Response) {
  const t = readCookie(req, COOKIE);
  if (t) await prisma.portalSession.updateMany({ where: { tokenHash: hashToken(t), revokedAt: null }, data: { revokedAt: new Date() } });
  clearCookie(res);
}

export const revokeAll = (accountId: string, exceptId?: string) =>
  prisma.portalSession.updateMany({ where: { accountId, revokedAt: null, ...(exceptId ? { id: { not: exceptId } } : {}) }, data: { revokedAt: new Date() } });

/** Finds the session behind the cookie, if it is still valid. Does not require MFA to be finished. */
export async function findSession(req: Request) {
  const t = readCookie(req, COOKIE);
  if (!t || t.length > 100) return null;
  const s = await prisma.portalSession.findUnique({ where: { tokenHash: hashToken(t) }, include: { account: true } });
  if (!s || s.revokedAt || s.expiresAt <= new Date()) return null;
  if (!s.mfaPending && Date.now() - s.lastSeenAt.getTime() > IDLE_MS) {
    await prisma.portalSession.update({ where: { id: s.id }, data: { revokedAt: new Date() } });
    return null;
  }
  if (!s.account.active || !s.account.passwordHash) return null;
  return s;
}

/** Loads the signed-in portal account. Rejects half-finished (two-step pending) sessions. */
export async function requirePortal(req: Request, res: Response, next: NextFunction) {
  try {
    const s = await findSession(req);
    if (!s) {
      clearCookie(res);
      throw new HttpError(401, "Please sign in");
    }
    // Half-way through sign-in: keep the cookie so the code can still be entered.
    if (s.mfaPending) throw new HttpError(401, "Enter the code from your authenticator app");
    // Touch at most once a minute to keep writes down.
    if (Date.now() - s.lastSeenAt.getTime() > 60_000) await prisma.portalSession.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } });
    const { account, ...session } = s;
    req.portal = { account, session };
    next();
  } catch (e) {
    next(e);
  }
}

/**
 * When the server requires two-step sign-in for everyone, accounts without it may only reach the
 * screens they need to turn it on.
 */
export function requireMfaIfMandatory(req: Request, _res: Response, next: NextFunction) {
  if (mfaRequiredForAll() && !req.portal!.account.mfaEnabled) return next(new HttpError(403, "Turn on two-step sign-in to continue"));
  next();
}

/** Removes expired sessions and links now and then. */
export async function sweep() {
  const cutoff = new Date(Date.now() - 30 * 86_400_000);
  await prisma.portalSession.deleteMany({ where: { OR: [{ expiresAt: { lt: cutoff } }, { revokedAt: { lt: cutoff } }] } });
  await prisma.portalToken.deleteMany({ where: { expiresAt: { lt: cutoff } } });
}
