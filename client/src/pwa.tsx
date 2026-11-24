// Installable app (PWA) support shared by the staff app and My Portal:
// service worker registration, phone detection, the "Install app" prompt and the "new version" notice.
import { useEffect, useState, useSyncExternalStore } from "react";

// ---------- phone detection ----------

const PHONE_QUERY = "(max-width: 760px), (pointer: coarse) and (max-width: 1024px) and (orientation: portrait)";
const mq = typeof window !== "undefined" ? window.matchMedia(PHONE_QUERY) : null;
const uaMobile = typeof navigator !== "undefined" && /Android|iPhone|iPod|Mobile|Windows Phone/i.test(navigator.userAgent);

/** True on phones (small screens, or a touch screen in portrait), so the app shows its native-style layout. */
export function isPhone() {
  return !!mq?.matches || (uaMobile && window.innerWidth <= 1024);
}

const subscribe = (cb: () => void) => {
  mq?.addEventListener("change", cb);
  window.addEventListener("resize", cb);
  return () => { mq?.removeEventListener("change", cb); window.removeEventListener("resize", cb); };
};

export function usePhone() {
  return useSyncExternalStore(subscribe, isPhone, () => false);
}

/** Opened from the home-screen icon rather than in a browser tab. */
export const isStandalone = () =>
  window.matchMedia("(display-mode: standalone)").matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;

const isIos = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

/** Marks <html> with .phone / .standalone so the stylesheet can switch to the native-style layout. */
function markDocument() {
  const html = document.documentElement;
  const apply = () => {
    html.classList.toggle("phone", isPhone());
    html.classList.toggle("standalone", isStandalone());
  };
  apply();
  subscribe(apply);
  window.matchMedia("(display-mode: standalone)").addEventListener("change", apply);
}

// ---------- install prompt ----------

interface InstallEvent extends Event { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> }
let deferred: InstallEvent | null = null;
const installListeners = new Set<() => void>();
const notify = () => installListeners.forEach((f) => f());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); deferred = e as InstallEvent; notify(); });
  window.addEventListener("appinstalled", () => { deferred = null; notify(); });
}

/** How this browser can install the app: a one-tap prompt (Chrome, Edge, Android), iOS "Add to Home Screen", or not at all. */
export function useInstall() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((n) => n + 1);
    installListeners.add(f);
    return () => { installListeners.delete(f); };
  }, []);
  if (isStandalone()) return { kind: "installed" as const };
  if (deferred) {
    return {
      kind: "prompt" as const,
      install: async () => {
        const d = deferred;
        if (!d) return;
        await d.prompt();
        await d.userChoice.catch(() => undefined);
        deferred = null;
        notify();
      },
    };
  }
  if (isIos()) return { kind: "ios" as const };
  return { kind: "none" as const };
}

const DISMISS_KEY = "ppc.installDismissed";

/** A small card on phones offering to put the app on the home screen. Hidden once installed or dismissed (for 30 days). */
export function InstallBanner({ appName, className = "" }: { appName: string; className?: string }) {
  const inst = useInstall();
  const phone = usePhone();
  const [hidden, setHidden] = useState(() => Number(localStorage.getItem(DISMISS_KEY) || 0) > Date.now());
  if (hidden || !phone || (inst.kind !== "prompt" && inst.kind !== "ios")) return null;
  const dismiss = () => { localStorage.setItem(DISMISS_KEY, String(Date.now() + 30 * 864e5)); setHidden(true); };
  return (
    <div className={"pwa-banner " + className} role="note">
      <img src="/icons/icon-192.png" alt="" />
      <div>
        <b>Install {appName}</b>
        {inst.kind === "prompt" ? <span>Open it from your home screen like a normal app.</span> : <span>Tap <ShareGlyph /> Share, then <b>Add to Home Screen</b></span>}
      </div>
      {inst.kind === "prompt" && <button className="pwa-go" onClick={inst.install}>Install</button>}
      <button className="pwa-x" onClick={dismiss} aria-label="Not now">✕</button>
    </div>
  );
}

export function InstallButton({ className }: { className?: string }) {
  const inst = useInstall();
  const [help, setHelp] = useState(false);
  if (inst.kind === "installed") return <p className="mu" style={{ margin: 0 }}>Installed on this device ✓</p>;
  if (inst.kind === "prompt") return <button className={className} onClick={inst.install}>Install app on this device</button>;
  if (inst.kind === "ios") {
    return help
      ? <p className="mu" style={{ margin: 0 }}>In Safari, tap <ShareGlyph /> Share, then <b>Add to Home Screen</b>.</p>
      : <button className={className} onClick={() => setHelp(true)}>Install app on this device</button>;
  }
  return null;
}

function ShareGlyph() {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" style={{ verticalAlign: "-3px" }} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-label="Share">
      <path d="M12 3v12M8 7l4-4 4 4" /><path d="M6 11H5a1 1 0 0 0-1 1v8a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-8a1 1 0 0 0-1-1h-1" />
    </svg>
  );
}

// ---------- service worker ----------

let updateReady = false;
const updateListeners = new Set<() => void>();

/** Registers the service worker (production builds only) and marks the page for phone styling. Call once at start-up. */
export function startPwa() {
  markDocument();
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    // A new version took over after a deploy: offer a reload instead of switching mid-task.
    if (hadController) { updateReady = true; updateListeners.forEach((f) => f()); }
  });
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).then((reg) => {
      // Store the files this page already loaded, so the app opens offline next time.
      const urls = [...performance.getEntriesByType("resource").map((r) => r.name), ...[...document.querySelectorAll<HTMLScriptElement | HTMLLinkElement>("script[src],link[rel=stylesheet],link[rel=modulepreload]")].map((el) => ("src" in el && el.src) || (el as HTMLLinkElement).href)];
      const send = () => (reg.active || navigator.serviceWorker.controller)?.postMessage({ type: "cache-urls", urls });
      navigator.serviceWorker.ready.then(send);
      // Check for a new version when the app comes back to the foreground.
      document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible") reg.update().catch(() => undefined); });
    }).catch(() => undefined);
  });
}

export function UpdateBanner() {
  const [ready, setReady] = useState(updateReady);
  useEffect(() => {
    const f = () => setReady(true);
    updateListeners.add(f);
    return () => { updateListeners.delete(f); };
  }, []);
  if (!ready) return null;
  return (
    <div className="pwa-update" role="status">
      <span>A new version of the app is ready.</span>
      <button onClick={() => location.reload()}>Reload</button>
    </div>
  );
}
