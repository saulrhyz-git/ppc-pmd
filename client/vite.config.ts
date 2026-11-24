import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";

/** In development, serve the separate portal page for /myportal and /myportal/... (the server does this in production). */
const portalPage = (): Plugin => ({
  name: "portal-page",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url && /^\/myportal(\/|$|\?|#)/.test(req.url) && !req.url.startsWith("/portal.html")) req.url = "/portal.html";
      next();
    });
  },
});

/** Builds dist/sw.js (the service worker that makes the app installable) with a version tied to this build. */
const pwa = (): Plugin => ({
  name: "pwa-service-worker",
  apply: "build",
  generateBundle(_opts, bundle) {
    const version = createHash("sha256").update(Object.keys(bundle).sort().join("|")).digest("hex").slice(0, 12);
    const source = readFileSync(resolve(import.meta.dirname, "pwa/sw.js"), "utf8").replace(`"__VERSION__"`, JSON.stringify(version));
    this.emitFile({ type: "asset", fileName: "sw.js", source });
  },
});

export default defineConfig({
  plugins: [react(), portalPage(), pwa()],
  build: {
    rollupOptions: {
      // Two pages: the staff app and the public owner / tenant portal, each with its own bundle.
      input: { main: resolve(import.meta.dirname, "index.html"), portal: resolve(import.meta.dirname, "portal.html") },
    },
  },
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:3000" },
  },
});
