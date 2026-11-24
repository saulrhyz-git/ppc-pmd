import express, { type NextFunction, type Request, type Response } from "express";
import session from "express-session";
import connectPg from "connect-pg-simple";
import helmet from "helmet";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { authRouter, HttpError, loadUser } from "./auth.ts";
import { dataRouter } from "./routes/data.ts";
import { concernsRouter } from "./routes/concerns.ts";
import { adminRouter } from "./routes/admin.ts";
import { workOrdersRouter } from "./routes/workorders.ts";
import { assetsRouter } from "./routes/assets.ts";
import { metersRouter } from "./routes/meters.ts";
import { requireAuth } from "./auth.ts";
import { PORTAL_PATH } from "@pmd/shared";
import { portalRouter } from "./portal/routes.ts";
import { portalAdminRouter } from "./portal/admin.ts";

const PORT = Number(process.env.PORT || 3000);
const isProd = process.env.NODE_ENV === "production";
const secret = process.env.SESSION_SECRET;
if (!secret || secret.length < 32) {
  if (isProd) throw new Error("SESSION_SECRET must be set to a random string of at least 32 characters");
  console.warn("SESSION_SECRET is not set; using an insecure development secret.");
}

const app = express();
app.set("trust proxy", process.env.TRUST_PROXY === "1" ? 1 : false);
app.use(helmet({ contentSecurityPolicy: { directives: { "img-src": ["'self'", "data:", "blob:"] } } }));
// The public owner / tenant portal has its own sign-in, cookie, body limits and rate limits, and is mounted
// before the staff session so staff cookies and staff routes are never involved in portal requests.
app.use("/api/portal", portalRouter);
app.use(express.json({ limit: "12mb" }));

const PgStore = connectPg(session);
app.use(
  session({
    name: "pmd.sid",
    store: new PgStore({ conString: process.env.DATABASE_URL, createTableIfMissing: true }),
    secret: secret || "dev-only-insecure-secret-change-me-please",
    resave: false,
    saveUninitialized: false,
    rolling: true,
    cookie: { httpOnly: true, sameSite: "lax", secure: process.env.COOKIE_SECURE === "1", maxAge: 8 * 60 * 60 * 1000 },
  }),
);
app.use(loadUser);

app.get("/api/health", (_req, res) => res.json({ ok: true }));
app.use("/api/auth", authRouter);
app.use("/api/concerns", concernsRouter);
app.use("/api/work-orders", workOrdersRouter);
app.use("/api/assets", assetsRouter);
app.use("/api/meters", metersRouter);
app.use("/api/portal-admin", requireAuth, portalAdminRouter);
app.use("/api", adminRouter);
app.use("/api", requireAuth, dataRouter);
app.use("/api", (_req, _res, next) => next(new HttpError(404, "Not found")));

// Serve the built React app in production.
const here = path.dirname(fileURLToPath(import.meta.url));
const dist = path.resolve(here, "../../client/dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: "1h" }));
  // The portal is a separate page with its own small bundle, so the public never downloads the staff app.
  app.get([PORTAL_PATH, PORTAL_PATH + "/*"], (_req, res) => res.sendFile(path.join(dist, "portal.html")));
  app.get("*", (_req, res) => res.sendFile(path.join(dist, "index.html")));
}

app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  if (err instanceof ZodError) return res.status(400).json({ error: err.issues.map((i) => (i.path.length ? i.path.join(".") + ": " : "") + i.message).join("; ") });
  if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
  if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return res.status(409).json({ error: "That name is already in use" });
  if (err && typeof err === "object" && "code" in err && (err as { code: string }).code === "LIMIT_FILE_SIZE") return res.status(400).json({ error: "Files can be at most 20 MB" });
  console.error(err);
  res.status(500).json({ error: "Something went wrong" });
});

app.listen(PORT, () => console.log(`PMD server listening on http://localhost:${PORT}`));
