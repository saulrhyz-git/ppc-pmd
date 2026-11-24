import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PORTAL_PASSWORD_MIN, passwordProblem, type PortalMeDTO } from "@pmd/shared";
import { papi, setSignedOutHandler } from "./api";
import { Icon, ThemeToggle, initials } from "./bits";
import { HomePage, RequestsPage } from "./Home";
import Account from "./Account";
import MetersPage from "./Meters";

type State = { state: "loading" } | { state: "none" } | { state: "mfa" } | { state: "ok"; me: PortalMeDTO };

export default function PortalApp() {
  const [s, setS] = useState<State>({ state: "loading" });
  const qc = useQueryClient();
  const refresh = useCallback(() => {
    papi.get<State>("/auth/state").then(setS).catch(() => setS({ state: "none" }));
  }, []);
  useEffect(() => {
    refresh();
    setSignedOutHandler(() => { qc.clear(); setS({ state: "none" }); });
  }, [refresh, qc]);
  const signedIn = (next: State) => { qc.clear(); setS(next); };
  const logout = useCallback(async () => { await papi.post("/auth/logout").catch(() => undefined); qc.clear(); setS({ state: "none" }); }, [qc]);

  if (s.state === "loading") return <div className="pp" />;
  const mustSecure = s.state === "ok" && s.me.mfaRequired && !s.me.mfaEnabled;
  return (
    <div className="pp">
      <Routes>
        <Route path="welcome" element={<Welcome onDone={signedIn} />} />
        <Route path="*" element={
          s.state === "none" ? <Login onDone={signedIn} /> :
          s.state === "mfa" ? <MfaStep onDone={signedIn} onCancel={logout} /> :
          <Shell me={s.me} onLogout={logout}>
            <Routes>
              <Route index element={mustSecure ? <Navigate to="/account" replace /> : <HomePage me={s.me} />} />
              <Route path="requests" element={mustSecure ? <Navigate to="/account" replace /> : <RequestsPage me={s.me} />} />
              <Route path="meters" element={mustSecure ? <Navigate to="/account" replace /> : <MetersPage me={s.me} />} />
              <Route path="account" element={<Account me={s.me} onChanged={refresh} />} />
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
          </Shell>
        } />
      </Routes>
    </div>
  );
}

// ---------- signed-in layout ----------

const LINKS: [string, string, string][] = [["/", "Home", "home"], ["/requests", "My requests", "list"], ["/meters", "Meters", "meter"], ["/account", "Account", "user"]];

function BrandMark() {
  return <><span className="pp-logo"><Icon name="building" /></span><span>My Portal<small>PPC Property Management</small></span></>;
}

function Shell({ me, onLogout, children }: { me: PortalMeDTO; onLogout: () => void; children: ReactNode }) {
  // Sign out after 30 minutes without activity on this screen too (the server enforces it regardless).
  useEffect(() => {
    let t = window.setTimeout(onLogout, 30 * 60_000);
    const bump = () => { window.clearTimeout(t); t = window.setTimeout(onLogout, 30 * 60_000); };
    const evs = ["pointerdown", "keydown"] as const;
    evs.forEach((e) => window.addEventListener(e, bump));
    return () => { window.clearTimeout(t); evs.forEach((e) => window.removeEventListener(e, bump)); };
  }, [onLogout]);
  // Start each screen at the top.
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return (
    <>
      <header className="pp-top">
        <NavLink to="/" className="pp-brand"><BrandMark /></NavLink>
        <nav className="pp-nav">{LINKS.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === "/"}><Icon name={icon} />{label}</NavLink>)}</nav>
        <span className="pp-sp" />
        <ThemeToggle />
        <div className="pp-me">
          <span className="pp-av" title={me.name}>{initials(me.name)}</span>
          <button className="pp-ghost" onClick={onLogout}>Sign out</button>
        </div>
      </header>
      <main className="pp-main">{children}</main>
      <nav className="pp-tabbar">{LINKS.map(([to, label, icon]) => <NavLink key={to} to={to} end={to === "/"}><Icon name={icon} />{label}</NavLink>)}</nav>
    </>
  );
}

// ---------- sign-in pages ----------

function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="pp-auth">
      <ThemeToggle />
      <aside className="pp-auth-side">
        <div className="pp-brand"><BrandMark /></div>
        <h1>Your home and workspace, looked after.</h1>
        <p>The portal for unit owners and tenants. Report a problem in a minute and follow the repair until it’s done.</p>
        <ul>
          <li><i>🛠️</i>Report leaks, aircon, electrical and other problems, with photos</li>
          <li><i>📍</i>See where every request is and when work is planned</li>
          <li><i>💬</i>Message property management about your request</li>
          <li><i>🔒</i>Private to you: only the units linked to your account</li>
        </ul>
      </aside>
      <div className="pp-auth-mobile">
        <div className="pp-brand"><BrandMark /></div>
        <h1>Your home and workspace, looked after.</h1>
        <p>Report a problem and follow the repair until it’s done.</p>
      </div>
      <div className="pp-auth-main"><div className="pp-auth-box">{children}</div></div>
    </div>
  );
}

function Login({ onDone }: { onDone: (s: State) => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try { onDone(await papi.post<State>("/auth/login", { email, password })); setPassword(""); }
    catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <h2>Welcome back</h2>
        <p className="mu">Sign in with the email your invitation was sent to.</p>
        <label className="pp-f"><span>Email</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="pp-f"><span>Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="pp-btn full" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        {err && <p className="pp-err">{err}</p>}
        <div className="pp-info" style={{ marginTop: 18 }}>
          <b>No account yet?</b> Accounts are by invitation. Ask your building’s property management office to invite you.<br /><br />
          <b>Forgot your password or changed phones?</b> The office can send you a reset link.
        </div>
      </form>
    </AuthLayout>
  );
}

function MfaStep({ onDone, onCancel }: { onDone: (s: State) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [after, setAfter] = useState<{ next: State; left: number } | null>(null);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await papi.post<State & { recoveryCodesLeft?: number }>("/auth/mfa", { code });
      if (useRecovery && r.recoveryCodesLeft !== undefined) setAfter({ next: r, left: r.recoveryCodesLeft }); else onDone(r);
    } catch (x) {
      setErr((x as Error).message);
      if ((x as { status?: number }).status === 401) onCancel();
    } finally { setBusy(false); }
  };
  if (after) {
    return (
      <AuthLayout>
        <h2>You’re in</h2>
        <p>You used a recovery code. You have <b>{after.left}</b> left.</p>
        <p className="mu">If you lost your phone, set up your authenticator app again under Account so you don’t run out.</p>
        <button className="pp-btn full" onClick={() => onDone(after.next)}>Continue</button>
      </AuthLayout>
    );
  }
  return (
    <AuthLayout>
      <form onSubmit={submit}>
        <h2>One more step</h2>
        <p className="mu">{useRecovery ? "Enter one of the recovery codes you saved." : "Open your authenticator app and enter the 6-digit code for My Portal."}</p>
        <label className="pp-f"><span>{useRecovery ? "Recovery code" : "6-digit code"}</span>
          <input autoFocus inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useRecovery ? 20 : 6} value={code} onChange={(e) => setCode(e.target.value.trim())} required
            style={useRecovery ? undefined : { letterSpacing: ".4em", fontSize: 22, textAlign: "center" }} />
        </label>
        <button className="pp-btn full" disabled={busy}>{busy ? "Checking…" : "Continue"}</button>
        {err && <p className="pp-err">{err}</p>}
        <div className="pp-row" style={{ marginTop: 14 }}>
          <button type="button" className="pp-link" onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>{useRecovery ? "Use my authenticator app" : "Use a recovery code"}</button>
          <span className="pp-sp" />
          <button type="button" className="pp-link" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </AuthLayout>
  );
}

/** Opened from an invitation or reset link: /myportal/welcome#t=<token>. */
function Welcome({ onDone }: { onDone: (s: State) => void }) {
  const nav = useNavigate();
  // Read the token once and remove it from the address bar and history straight away.
  const [token] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get("t") ?? "");
  useEffect(() => { if (window.location.hash) window.history.replaceState(null, "", window.location.pathname); }, []);
  const check = useQuery({
    queryKey: ["link", token], enabled: !!token, retry: false, staleTime: Infinity,
    queryFn: () => papi.post<{ purpose: "invite" | "reset"; email: string; name: string }>("/auth/link/check", { token }),
  });
  const [name, setName] = useState<string | null>(null);
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const info = check.data;
  const shownName = name ?? info?.name ?? "";
  const problem = pw ? passwordProblem(pw, info?.email, shownName) : null;
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr("");
    if (problem) return setErr(problem);
    if (pw !== pw2) return setErr("The two passwords don’t match");
    setBusy(true);
    try {
      const r = await papi.post<State>("/auth/link/use", { token, password: pw, ...(info?.purpose === "invite" ? { name: shownName } : {}) });
      onDone(r);
      nav("/", { replace: true });
    } catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <AuthLayout>
      {!token || check.isError ? (
        <>
          <h2>This link doesn’t work</h2>
          <p className="mu">{check.error ? (check.error as Error).message : "The link looks incomplete. Open it again from the message you received."}</p>
          <button type="button" className="pp-btn full" onClick={() => nav("/", { replace: true })}>Go to sign in</button>
        </>
      ) : !info ? <p className="mu">Checking your link…</p> : (
        <form onSubmit={submit}>
          <h2>{info.purpose === "invite" ? "Welcome to My Portal" : "Choose a new password"}</h2>
          <p className="mu">{info.purpose === "invite" ? "Your property management office has invited you. Set a password to finish creating your account." : "Pick a new password for your account."}</p>
          <div className="pp-info" style={{ marginTop: 10 }}>Your account: <b>{info.email}</b></div>
          {info.purpose === "invite" && (
            <label className="pp-f"><span>Your name</span><input value={shownName} onChange={(e) => setName(e.target.value)} required maxLength={200} autoComplete="name" /></label>
          )}
          <input type="email" autoComplete="username" value={info.email} readOnly hidden />
          <label className="pp-f"><span>Password</span>
            <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            <small>At least {PORTAL_PASSWORD_MIN} characters. A short sentence you’ll remember works well, like “Mango tree by window 7”.</small>
          </label>
          {problem && <p className="pp-err">{problem}</p>}
          <label className="pp-f"><span>Type it again</span><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></label>
          <button className="pp-btn full" disabled={busy || !!problem}>{busy ? "Saving…" : info.purpose === "invite" ? "Create my account" : "Save new password"}</button>
          {err && <p className="pp-err">{err}</p>}
        </form>
      )}
    </AuthLayout>
  );
}
