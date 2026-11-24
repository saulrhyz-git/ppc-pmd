// PPC service worker. Built into dist/sw.js by the "pwa" plugin in vite.config.ts, which fills in the build version.
// - API calls (/api/...) always go to the network and are never stored: data stays fresh and private.
// - Built files under /assets/ have content hashes in their names, so they are served from the cache once stored.
// - Pages are fetched from the network first; when offline the last copy of the app shell (staff app or My Portal)
//   is shown, or a small "You're offline" page.
const VERSION = "__VERSION__";
const SHELL = "ppc-shell-" + VERSION;
const ASSETS = "ppc-assets-" + VERSION;
const PRECACHE = ["/offline.html", "/icons/icon-192.png"];
const PORTAL = "/myportal";

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("ppc-") && k !== SHELL && k !== ASSETS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isPortal = (path) => path === PORTAL || path.startsWith(PORTAL + "/");
const shellKey = (path) => (isPortal(path) ? PORTAL : "/");

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // network only, never cached

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && (res.headers.get("content-type") || "").includes("text/html")) {
            const copy = res.clone();
            caches.open(SHELL).then((c) => c.put(shellKey(url.pathname), copy));
          }
          return res;
        })
        .catch(async () => (await caches.match(shellKey(url.pathname), { cacheName: SHELL })) || (await caches.match("/offline.html")) || Response.error()),
    );
    return;
  }

  if (url.pathname.startsWith("/assets/")) {
    e.respondWith(
      caches.open(ASSETS).then(async (c) => {
        const hit = await c.match(req);
        if (hit) return hit;
        const res = await fetch(req);
        if (res.ok) c.put(req, res.clone());
        return res;
      }),
    );
    return;
  }

  // Icons, manifests, favicon: show the stored copy at once and refresh it in the background.
  if (/^\/(icons\/|favicon\.svg$|[\w-]+\.webmanifest$)/.test(url.pathname)) {
    e.respondWith(
      caches.open(SHELL).then(async (c) => {
        const hit = await c.match(req);
        const net = fetch(req).then((res) => { if (res.ok) c.put(req, res.clone()); return res; }).catch(() => hit);
        return hit || net;
      }),
    );
  }
});

// The page sends the files it loaded before this worker took control, so the app also opens offline the first time.
self.addEventListener("message", (e) => {
  const d = e.data || {};
  if (d.type === "cache-urls" && Array.isArray(d.urls)) {
    const urls = d.urls.filter((u) => { try { const x = new URL(u, self.location.origin); return x.origin === self.location.origin && x.pathname.startsWith("/assets/"); } catch { return false; } });
    e.waitUntil(caches.open(ASSETS).then((c) => Promise.all(urls.map((u) => c.match(u).then((hit) => hit || c.add(u).catch(() => undefined))))));
  }
});
