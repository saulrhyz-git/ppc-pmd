import { Router, type NextFunction, type Request, type Response } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { defaultTabs, ROLES, type Role, type SessionUser, type TabAccess, type TabKey } from "@pmd/shared";
import { prisma, audit } from "./db.ts";

declare module "express-session" {
  interface SessionData {
    userId?: string;
  }
}
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function toSessionUser(u: { id: string; email: string; name: string; role: string; section: string | null; properties: string[]; canApprove: boolean; tabs: unknown }): SessionUser {
  const role = (ROLES as readonly string[]).includes(u.role) ? (u.role as Role) : "Admin/Engineer";
  return { id: u.id, email: u.email, name: u.name, role, section: u.section, properties: u.properties, canApprove: u.canApprove, tabs: { ...defaultTabs(role), ...((u.tabs as TabAccess) || {}) } };
}

/** Loads the signed-in user on every request (so role changes apply immediately). */
export async function loadUser(req: Request, _res: Response, next: NextFunction) {
  try {
    if (req.session.userId) {
      const u = await prisma.user.findUnique({ where: { id: req.session.userId } });
      if (u && u.active) req.user = toSessionUser(u);
      else delete req.session.userId;
    }
    next();
  } catch (e) {
    next(e);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(new HttpError(401, "Please sign in"));
  next();
}

export const requireRole = (...roles: Role[]) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, "Please sign in"));
  if (!roles.includes(req.user.role)) return next(new HttpError(403, "You do not have access to this"));
  next();
};

export const requireTab = (tab: TabKey, level: 1 | 2 = 1) => (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, "Please sign in"));
  if ((req.user.tabs[tab] ?? 0) < level) return next(new HttpError(403, "You do not have access to this"));
  next();
};

export const staffOnly = (req: Request, _res: Response, next: NextFunction) => {
  if (!req.user) return next(new HttpError(401, "Please sign in"));
  if (req.user.role === "Tenant") return next(new HttpError(403, "Staff only"));
  next();
};

const MAX_FAILS = 5, LOCK_MIN = 15;

export const authRouter = Router();

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

authRouter.post("/login", loginLimiter, async (req, res, next) => {
  try {
    const { email, password } = z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(1) }).parse(req.body);
    const u = await prisma.user.findUnique({ where: { email } });
    if (!u || !u.active) throw new HttpError(401, "Wrong email or password");
    if (u.lockedUntil && u.lockedUntil > new Date()) throw new HttpError(423, `Too many failed attempts. Try again after ${u.lockedUntil.toLocaleTimeString()}.`);
    const ok = await bcrypt.compare(password, u.passwordHash);
    if (!ok) {
      const fails = u.failedLogins + 1;
      await prisma.user.update({ where: { id: u.id }, data: { failedLogins: fails >= MAX_FAILS ? 0 : fails, lockedUntil: fails >= MAX_FAILS ? new Date(Date.now() + LOCK_MIN * 60e3) : null } });
      await audit(null, "login.failed", { email });
      throw new HttpError(401, "Wrong email or password");
    }
    await prisma.user.update({ where: { id: u.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
    req.session.regenerate((err) => {
      if (err) return next(err);
      req.session.userId = u.id;
      req.session.save(async (err2) => {
        if (err2) return next(err2);
        const su = toSessionUser(u);
        await audit(su, "login");
        res.json({ user: su });
      });
    });
  } catch (e) {
    next(e);
  }
});

authRouter.post("/logout", (req, res) => {
  req.session.destroy(() => {
    res.clearCookie("pmd.sid");
    res.json({ ok: true });
  });
});

authRouter.get("/me", (req, res) => {
  res.json({ user: req.user ?? null });
});

authRouter.post("/password", requireAuth, async (req, res, next) => {
  try {
    const { current, next: nw } = z.object({ current: z.string(), next: z.string().min(8, "Use at least 8 characters") }).parse(req.body);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!(await bcrypt.compare(current, u.passwordHash))) throw new HttpError(400, "Current password is wrong");
    await prisma.user.update({ where: { id: u.id }, data: { passwordHash: await bcrypt.hash(nw, 12) } });
    await audit(req.user!, "password.change");
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});
