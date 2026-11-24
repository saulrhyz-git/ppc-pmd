// Security primitives for the public owner / tenant portal.
// Nothing here trusts the browser: tokens are random, only their hashes are stored,
// MFA secrets are encrypted at rest, and comparisons are constant-time.
import crypto from "node:crypto";
import fs from "node:fs";
import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { HttpError } from "../auth.ts";

const isProd = process.env.NODE_ENV === "production";

// ---------- secrets ----------
const rawKey = process.env.PORTAL_SECRET || process.env.SESSION_SECRET || "";
if (isProd && rawKey.length < 32) throw new Error("PORTAL_SECRET (or SESSION_SECRET) must be at least 32 characters");
/** Key used to encrypt MFA secrets. Derived so the session secret itself is never used directly. */
const encKey = crypto.createHash("sha256").update("ppc-portal-mfa:" + (rawKey || "dev-only-insecure-portal-secret")).digest();

export const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString("base64url");
export const hashToken = (t: string) => crypto.createHash("sha256").update(t).digest("hex");

export function safeEqual(a: string, b: string) {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

export function encrypt(plain: string) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", encKey, iv);
  const body = Buffer.concat([c.update(plain, "utf8"), c.final()]);
  return ["v1", iv.toString("base64url"), c.getAuthTag().toString("base64url"), body.toString("base64url")].join(".");
}

export function decrypt(blob: string) {
  const [v, iv, tag, body] = blob.split(".");
  if (v !== "v1") throw new Error("Unknown secret format");
  const d = crypto.createDecipheriv("aes-256-gcm", encKey, Buffer.from(iv, "base64url"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(body, "base64url")), d.final()]).toString("utf8");
}

// ---------- TOTP (RFC 6238, SHA-1, 6 digits, 30 s) ----------
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function base32Encode(buf: Buffer) {
  let bits = 0, value = 0, out = "";
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(s: string) {
  const clean = s.replace(/[\s=-]/g, "").toUpperCase();
  let bits = 0, value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error("Bad base32");
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Buffer.from(out);
}

export const newTotpSecret = () => base32Encode(crypto.randomBytes(20));

export function totp(secretB32: string, step: number) {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(step));
  const h = crypto.createHmac("sha1", base32Decode(secretB32)).update(msg).digest();
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, "0");
}

/**
 * Checks a 6-digit code, allowing one step of clock drift either way.
 * Returns the matched time step so the caller can refuse to accept the same code twice.
 */
export function verifyTotp(secretB32: string, code: string, lastStep: number | null, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const cur = Math.floor(now / 30_000);
  for (const s of [cur - 1, cur, cur + 1]) {
    if (lastStep != null && s <= lastStep) continue;
    if (safeEqual(totp(secretB32, s), code)) return s;
  }
  return null;
}

export const otpauthUrl = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent("PPC Portal:" + email)}?secret=${secret}&issuer=${encodeURIComponent("PPC Portal")}&algorithm=SHA1&digits=6&period=30`;

/** Ten one-time recovery codes like "k7pq-2mxd-9rtw". Only their hashes are stored. */
export function newRecoveryCodes() {
  const alpha = "abcdefghjkmnpqrstuvwxyz23456789";
  return Array.from({ length: 10 }, () => {
    const b = crypto.randomBytes(12);
    const s = [...b].map((x) => alpha[x % alpha.length]).join("");
    return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
  });
}
export const normRecovery = (c: string) => c.toLowerCase().replace(/[^a-z0-9]/g, "");

// ---------- request guards ----------

/**
 * Cross-site request protection for the portal API. The session cookie is SameSite=Strict, and on top of that
 * every state-changing request must carry a custom header (which a foreign site cannot send without a CORS
 * preflight, and we never answer preflights) and, when the browser sends an Origin, it must be our own.
 */
export function portalCsrf(req: Request, _res: Response, next: NextFunction) {
  if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") return next();
  if (req.get("x-ppc-portal") !== "1") return next(new HttpError(403, "Request blocked"));
  const origin = req.get("origin");
  if (origin) {
    const allowed = allowedOrigins(req);
    if (!allowed.includes(origin)) return next(new HttpError(403, "Request blocked"));
  }
  next();
}

function allowedOrigins(req: Request) {
  const list = (process.env.PORTAL_ALLOWED_ORIGINS || "").split(",").map((s) => s.trim()).filter(Boolean);
  if (process.env.PORTAL_PUBLIC_URL) list.push(new URL(process.env.PORTAL_PUBLIC_URL).origin);
  list.push(`${req.protocol}://${req.get("host")}`);
  if (!isProd) list.push("http://localhost:5173", "http://127.0.0.1:5173");
  return list;
}

/** No caching of portal API answers anywhere (shared computers, proxies). */
export function noStore(_req: Request, res: Response, next: NextFunction) {
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Referrer-Policy", "no-referrer");
  next();
}

/** IPv6 clients are grouped by /64, since one person usually controls the whole block. */
const ipKey = (req: Request) => {
  const ip = req.ip ?? "";
  return ip.includes(":") && !ip.startsWith("::ffff:") ? ip.split(":").slice(0, 4).join(":") + "::/64" : ip;
};

const limiter = (windowMin: number, limit: number, key?: (req: Request) => string) =>
  rateLimit({
    windowMs: windowMin * 60_000, limit, standardHeaders: "draft-7", legacyHeaders: false,
    keyGenerator: key ?? ((req) => ipKey(req)),
    handler: (_req, _res, next) => next(new HttpError(429, "Too many attempts. Please wait a few minutes and try again.")),
  });

const ipAnd = (field: string) => (req: Request) => ipKey(req) + "|" + String((req.body as Record<string, unknown>)?.[field] ?? "").toLowerCase().slice(0, 200);

export const limits = {
  /** Whole portal API, per IP. */
  global: limiter(1, 120),
  /** Sign-in attempts per IP, and per IP + email. */
  loginIp: limiter(15, 30),
  loginEmail: limiter(15, 8, ipAnd("email")),
  /** Two-step code attempts per IP. */
  mfa: limiter(15, 15),
  /** Invite / reset links per IP. */
  token: limiter(60, 20),
  /** New requests per signed-in account per day. */
  newRequest: limiter(24 * 60, 30, (req) => "acct:" + (req.portal?.account.id ?? ipKey(req))),
  /** Follow-ups per account per hour. */
  followup: limiter(60, 60, (req) => "acct:" + (req.portal?.account.id ?? ipKey(req))),
};

// ---------- uploads ----------

/** Allowed upload types, checked against the file's first bytes and not the name or the browser's claim. */
const SIGNATURES: [string, (b: Buffer) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["image/gif", (b) => b.subarray(0, 4).toString("latin1") === "GIF8"],
  ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
  ["image/heic", (b) => b.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|hevc|mif1|msf1)$/.test(b.subarray(8, 12).toString("latin1"))],
  ["application/pdf", (b) => b.subarray(0, 5).toString("latin1") === "%PDF-"],
];

/** Returns the real type of an uploaded file, or null when it is not an allowed photo or PDF. */
export function sniffFile(path: string): string | null {
  const fd = fs.openSync(path, "r");
  try {
    const b = Buffer.alloc(16);
    fs.readSync(fd, b, 0, 16, 0);
    return SIGNATURES.find(([, ok]) => ok(b))?.[0] ?? null;
  } finally {
    fs.closeSync(fd);
  }
}

/** A short, harmless description of the browser, for the "where you are signed in" list. */
export function describeAgent(ua: string) {
  const os = /iPhone|iPad/.test(ua) ? "iPhone/iPad" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Unknown device";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "Browser";
  return `${br} on ${os}`;
}
