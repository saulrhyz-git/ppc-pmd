import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { resolve } from "node:path";

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

export default defineConfig({
  plugins: [react(), portalPage()],
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
