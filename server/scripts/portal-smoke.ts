// End-to-end security check of the owner / tenant portal against a running server.
// Usage: BASE=http://localhost:3000 STAFF_EMAIL=dh@example.com STAFF_PASSWORD=... UNIT_A=<unit id> UNIT_B=<unit id in another building> \
//        npx tsx --env-file-if-exists=../.env scripts/portal-smoke.ts
// It creates two test portal accounts (portal-smoke-*@example.com). Run it on a development database only.
import assert from "node:assert/strict";
import { decrypt, totp } from "../src/portal/security.ts";
import { prisma } from "../src/db.ts";

const BASE = process.env.BASE || "http://localhost:3000";
const UNIT_A = process.env.UNIT_A!, UNIT_B = process.env.UNIT_B!;
if (!UNIT_A || !UNIT_B) throw new Error("Set UNIT_A and UNIT_B");

class Client {
  jar = new Map<string, string>();
  constructor(public portal: boolean) {}
  async call(method: string, url: string, body?: unknown, opts: { csrf?: boolean; origin?: string } = {}) {
    const headers: Record<string, string> = {};
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    if (this.portal && opts.csrf !== false) headers["x-ppc-portal"] = "1";
    if (opts.origin) headers.origin = opts.origin;
    let payload: BodyInit | undefined;
    if (body instanceof FormData) payload = body;
    else if (body !== undefined) { headers["content-type"] = "application/json"; payload = JSON.stringify(body); }
    const res = await fetch(BASE + url, { method, headers, body: payload, redirect: "manual" });
    for (const c of res.headers.getSetCookie()) {
      const [kv] = c.split(";");
      const i = kv.indexOf("=");
      const k = kv.slice(0, i), v = kv.slice(i + 1);
      if (v === "" || /Max-Age=0/.test(c)) this.jar.delete(k); else this.jar.set(k, v);
    }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { json = text; }
    return { status: res.status, json, headers: res.headers };
  }
}

const ok = (name: string) => console.log("  ✓ " + name);
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082", "hex");

async function main() {
  const stamp = Date.now();
  const emailA = `portal-smoke-a-${stamp}@example.com`, emailB = `portal-smoke-b-${stamp}@example.com`;
  const pw = "Correct-Horse-Battery-42";

  console.log("Staff side");
  const staff = new Client(false);
  let r = await staff.call("POST", "/api/auth/login", { email: process.env.STAFF_EMAIL || "dh@example.com", password: process.env.STAFF_PASSWORD || "ChangeMe123!" });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  r = await staff.call("POST", "/api/portal-admin/invite", { email: emailA, name: "Ana Owner", unitId: UNIT_A, relation: "Owner" });
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const linkA: string = r.json.link.url;
  assert.match(linkA, /\/myportal\/welcome#t=/);
  ok("invite creates a one-time link with the token after #");
  r = await staff.call("POST", "/api/portal-admin/invite", { email: emailB, name: "Ben Tenant", unitId: UNIT_B, relation: "Tenant" });
  const linkB: string = r.json.link.url;
  const tokenA = linkA.split("#t=")[1], tokenB = linkB.split("#t=")[1];

  const tech = new Client(false);
  r = await tech.call("POST", "/api/auth/login", { email: "tech1@example.com", password: "ChangeMe123!" });
  r = await tech.call("GET", "/api/portal-admin/accounts");
  assert.equal(r.status, 403);
  ok("technicians cannot manage portal access");

  console.log("Invitation");
  const a = new Client(true);
  r = await a.call("POST", "/api/portal/auth/link/check", { token: tokenA });
  assert.equal(r.status, 200); assert.equal(r.json.email, emailA);
  r = await a.call("POST", "/api/portal/auth/link/use", { token: tokenA, password: "short" });
  assert.equal(r.status, 400);
  r = await a.call("POST", "/api/portal/auth/link/use", { token: tokenA, password: "anaowner-is-great" });
  assert.equal(r.status, 400, "password containing the name is refused");
  ok("weak passwords are refused");
  r = await a.call("POST", "/api/portal/auth/link/use", { token: tokenA, password: pw }, { csrf: false });
  assert.equal(r.status, 403);
  r = await a.call("POST", "/api/portal/auth/link/use", { token: tokenA, password: pw }, { origin: "https://evil.example" });
  assert.equal(r.status, 403);
  ok("requests without the portal header or from another origin are blocked");
  r = await a.call("POST", "/api/portal/auth/link/use", { token: tokenA, password: pw });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.state, "ok");
  assert.equal(r.json.me.units.length, 1);
  r = await new Client(true).call("POST", "/api/portal/auth/link/use", { token: tokenA, password: pw + "x" });
  assert.equal(r.status, 400);
  ok("invitation sets the password, signs in, and cannot be used twice");
  const cookie = [...a.jar.values()][0];
  assert.ok(cookie && cookie.length >= 40);

  const b = new Client(true);
  r = await b.call("POST", "/api/portal/auth/link/use", { token: tokenB, password: pw });
  assert.equal(r.status, 200);

  console.log("Requests and isolation");
  const f = new FormData();
  f.append("unitId", UNIT_A); f.append("trade", "Plumbing"); f.append("concern", "Kitchen sink is leaking under the cabinet"); f.append("urgency", "Urgent");
  f.append("files", new Blob([PNG], { type: "image/png" }), "leak.png");
  r = await a.call("POST", "/api/portal/requests", f);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  const reqId = r.json.id, attId = r.json.attachments[0].id;
  assert.equal(r.json.attachments.length, 1);
  ok("owner files a request with a photo");

  const bad = new FormData();
  bad.append("unitId", UNIT_A); bad.append("trade", "Plumbing"); bad.append("concern", "fake image upload test");
  bad.append("files", new Blob([Buffer.from("<script>alert(1)</script>")], { type: "image/png" }), "x.png");
  r = await a.call("POST", "/api/portal/requests", bad);
  assert.equal(r.status, 400);
  ok("a file pretending to be a photo is refused");

  const f2 = new FormData();
  f2.append("unitId", UNIT_A); f2.append("trade", "Plumbing"); f2.append("concern", "Trying to file for someone else's unit");
  r = await b.call("POST", "/api/portal/requests", f2);
  assert.equal(r.status, 404);
  r = await b.call("GET", `/api/portal/requests/${reqId}`);
  assert.equal(r.status, 404);
  r = await b.call("GET", `/api/portal/attachments/${attId}`);
  assert.equal(r.status, 404);
  r = await b.call("GET", "/api/portal/requests");
  assert.equal(r.json.length, 0);
  ok("another account cannot file for, see, or download from a unit it has no access to");

  r = await a.call("GET", `/api/portal/attachments/${attId}`);
  assert.equal(r.status, 200); assert.equal(r.headers.get("content-type"), "image/png");
  assert.match(r.headers.get("content-security-policy") || "", /sandbox/);
  ok("owner can download their own photo (sandboxed)");

  r = await staff.call("GET", "/api/concerns");
  const sc = r.json.find((c: any) => c.id === reqId);
  assert.ok(sc, "staff inbox shows the portal request");
  assert.equal(sc.source, "portal");
  r = await staff.call("POST", `/api/concerns/${reqId}/receive`);
  assert.equal(r.status, 200);
  const sf = new FormData(); sf.append("message", "A plumber will come tomorrow at 10."); sf.append("status", "In progress");
  r = await staff.call("POST", `/api/concerns/${reqId}/updates`, sf);
  assert.equal(r.status, 201, JSON.stringify(r.json));
  r = await a.call("GET", `/api/portal/requests/${reqId}`);
  assert.equal(r.json.status, "In progress");
  assert.ok(r.json.updates.some((u: any) => u.authorName === "Property management" && /plumber/.test(u.message)));
  ok("staff receive and answer it in the existing inbox; the owner sees the reply");

  r = await staff.call("GET", "/api/portal/me");
  assert.equal(r.status, 401);
  r = await a.call("GET", "/api/concerns");
  assert.equal(r.status, 401);
  ok("staff and portal cookies do not work on each other's API");

  console.log("Two-step sign-in");
  r = await a.call("POST", "/api/portal/account/mfa/setup", { password: pw });
  assert.equal(r.status, 200);
  const secret: string = r.json.secret;
  const step = Math.floor(Date.now() / 30000);
  r = await a.call("POST", "/api/portal/account/mfa/enable", { code: totp(secret, step) });
  assert.equal(r.status, 200); assert.equal(r.json.recoveryCodes.length, 10);
  const recovery: string = r.json.recoveryCodes[0];
  const stored = await prisma.portalAccount.findUniqueOrThrow({ where: { email: emailA } });
  assert.notEqual(stored.mfaSecret, secret); assert.equal(decrypt(stored.mfaSecret!), secret);
  assert.ok(!stored.recoveryCodes.includes(recovery));
  ok("authenticator set up; secret encrypted and recovery codes hashed at rest");

  r = await a.call("POST", "/api/portal/auth/logout");
  r = await a.call("GET", "/api/portal/me");
  assert.equal(r.status, 401);
  r = await a.call("POST", "/api/portal/auth/login", { email: emailA, password: pw });
  assert.equal(r.json.state, "mfa");
  r = await a.call("GET", "/api/portal/me");
  assert.equal(r.status, 401);
  ok("password alone does not open the account");
  r = await a.call("POST", "/api/portal/auth/mfa", { code: totp(secret, step) });
  assert.equal(r.status, 400);
  ok("an authenticator code cannot be used twice");
  r = await a.call("POST", "/api/portal/auth/mfa", { code: recovery });
  assert.equal(r.status, 200, JSON.stringify(r.json)); assert.equal(r.json.recoveryCodesLeft, 9);
  r = await a.call("POST", "/api/portal/auth/logout");
  r = await a.call("POST", "/api/portal/auth/login", { email: emailA, password: pw });
  r = await a.call("POST", "/api/portal/auth/mfa", { code: recovery });
  assert.equal(r.status, 400);
  ok("recovery codes work once");

  console.log("Lockout and revocation");
  const c = new Client(true);
  for (let i = 0; i < 5; i++) await c.call("POST", "/api/portal/auth/login", { email: emailB, password: "wrong-password-" + i });
  r = await c.call("POST", "/api/portal/auth/login", { email: emailB, password: pw });
  assert.equal(r.status, 401);
  r = await c.call("POST", "/api/portal/auth/login", { email: "nobody-" + stamp + "@example.com", password: pw });
  assert.equal(r.status, 401);
  ok("five wrong passwords lock the account; unknown emails get the same answer");

  r = await staff.call("GET", `/api/portal-admin/accounts?unitId=${UNIT_B}`);
  const accB = r.json.find((x: any) => x.email === emailB);
  assert.equal(accB.state, "Locked");
  r = await staff.call("POST", `/api/portal-admin/accounts/${accB.id}/unlock`);
  assert.equal(r.json.state, "Active");
  r = await b.call("GET", "/api/portal/me");
  assert.equal(r.status, 200);
  r = await staff.call("POST", `/api/portal-admin/access/${accB.access[0].id}/revoke`);
  assert.equal(r.status, 200);
  r = await b.call("GET", "/api/portal/me");
  assert.equal(r.json.units.length, 0);
  r = await staff.call("POST", `/api/portal-admin/accounts/${accB.id}/disable`);
  r = await b.call("GET", "/api/portal/me");
  assert.equal(r.status, 401);
  ok("staff unlock, revoke unit access and disable; disabling signs the person out at once");

  r = await staff.call("POST", `/api/portal-admin/accounts/${stored.id}/link`);
  assert.equal(r.json.purpose, "reset");
  const resetToken = r.json.link.url.split("#t=")[1];
  const d = new Client(true);
  r = await d.call("POST", "/api/portal/auth/link/use", { token: resetToken, password: "Another-Long-Passphrase-7" });
  assert.equal(r.json.state, "mfa");
  ok("a password reset link still asks for the two-step code");

  await prisma.portalAccount.deleteMany({ where: { email: { in: [emailA, emailB] } } });
  console.log("\nAll portal checks passed.");
}

main().then(() => prisma.$disconnect(), async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
