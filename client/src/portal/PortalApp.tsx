import { useCallback, useEffect, useState, type FormEvent, type ReactNode } from "react";
import { Navigate, NavLink, Route, Routes, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PORTAL_PASSWORD_MIN, passwordProblem, type PortalMeDTO } from "@pmd/shared";
import { papi, setSignedOutHandler } from "./api";
import { ThemeToggle } from "./bits";
import Home from "./Home";
import Account from "./Account";

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
  const logout = async () => { await papi.post("/auth/logout").catch(() => undefined); qc.clear(); setS({ state: "none" }); };

  if (s.state === "loading") return null;
  return (
    <Routes>
      <Route path="welcome" element={<Welcome onDone={signedIn} />} />
      <Route path="*" element={
        s.state === "none" ? <Login onDone={signedIn} /> :
        s.state === "mfa" ? <MfaStep onDone={signedIn} onCancel={logout} /> :
        <Shell me={s.me} onLogout={logout}>
          <Routes>
            <Route index element={s.me.mfaRequired && !s.me.mfaEnabled ? <Navigate to="/account" replace /> : <Home me={s.me} />} />
            <Route path="account" element={<Account me={s.me} onChanged={refresh} />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Shell>
      } />
    </Routes>
  );
}

function Frame({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <>
      <header>
        <div className="top">
          <div><h1>PPC <b>Owner &amp; Tenant</b> Portal</h1><small>Property Management Department</small></div>
          <div className="row" style={{ marginLeft: "auto" }}>{right}<ThemeToggle /></div>
        </div>
      </header>
      <main>{children}</main>
    </>
  );
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
  return (
    <Frame right={
      <div className="chip">
        <div className="av">{me.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase()}</div>
        <div className="tx"><b>{me.name}</b><small>{me.email}</small></div>
        <button onClick={onLogout}>Sign out</button>
      </div>
    }>
      <div className="tabs" style={{ marginBottom: 12 }}>
        <NavLink to="/" end>{({ isActive }) => <button className={isActive ? "on" : ""}>My units &amp; requests</button>}</NavLink>
        <NavLink to="/account">{({ isActive }) => <button className={isActive ? "on" : ""}>Account &amp; security{!me.mfaEnabled ? " ⚠︎" : ""}</button>}</NavLink>
      </div>
      {children}
    </Frame>
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
    <Frame>
      <form className="card pform" onSubmit={submit}>
        <h2>Sign in</h2>
        <p className="mu">For unit owners, tenants and their representatives. Accounts are by invitation from property management.</p>
        <label className="ff"><span className="mu">Email</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
        <label className="ff"><span className="mu">Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
        <button className="cta" disabled={busy} style={{ width: "100%", marginTop: 6 }}>{busy ? "Signing in…" : "Sign in"}</button>
        {err && <p className="err">{err}</p>}
        <p className="mu" style={{ marginTop: 14 }}>Forgot your password or lost your phone? Contact property management for a reset link.</p>
      </form>
    </Frame>
  );
}

function MfaStep({ onDone, onCancel }: { onDone: (s: State) => void; onCancel: () => void }) {
  const [code, setCode] = useState("");
  const [useRecovery, setUseRecovery] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(""); setBusy(true);
    try {
      const r = await papi.post<State & { recoveryCodesLeft?: number }>("/auth/mfa", { code });
      if (useRecovery && r.recoveryCodesLeft !== undefined) window.alert(`Recovery code used. You have ${r.recoveryCodesLeft} left. Set up your authenticator again under Account & security if you lost your phone.`);
      onDone(r);
    } catch (x) {
      setErr((x as Error).message);
      if ((x as { status?: number }).status === 401) onCancel();
    } finally { setBusy(false); }
  };
  return (
    <Frame>
      <form className="card pform" onSubmit={submit}>
        <h2>Two-step sign-in</h2>
        <p className="mu">{useRecovery ? "Enter one of your recovery codes." : "Enter the 6-digit code from your authenticator app."}</p>
        <label className="ff"><span className="mu">{useRecovery ? "Recovery code" : "Code"}</span>
          <input autoFocus inputMode={useRecovery ? "text" : "numeric"} autoComplete="one-time-code" maxLength={useRecovery ? 20 : 6} value={code} onChange={(e) => setCode(e.target.value.trim())} required />
        </label>
        <button className="cta" disabled={busy} style={{ width: "100%", marginTop: 6 }}>{busy ? "Checking…" : "Continue"}</button>
        {err && <p className="err">{err}</p>}
        <div className="row" style={{ marginTop: 12 }}>
          <button type="button" className="lnk" onClick={() => { setUseRecovery(!useRecovery); setCode(""); }}>{useRecovery ? "Use my authenticator app" : "Use a recovery code"}</button>
          <span className="spacer" />
          <button type="button" className="lnk" onClick={onCancel}>Cancel</button>
        </div>
      </form>
    </Frame>
  );
}

/** Opened from an invitation or reset link: /portal/welcome#t=<token>. */
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
    if (pw !== pw2) return setErr("The two passwords do not match");
    setBusy(true);
    try {
      const r = await papi.post<State>("/auth/link/use", { token, password: pw, ...(info?.purpose === "invite" ? { name: shownName } : {}) });
      onDone(r);
      nav(r.state === "ok" && info?.purpose === "invite" ? "/account" : "/", { replace: true });
    } catch (x) { setErr((x as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Frame>
      <form className="card pform" onSubmit={submit}>
        {!token || check.isError ? (
          <>
            <h2>Link not valid</h2>
            <p className="mu">{check.error ? (check.error as Error).message : "This link is incomplete. Open it again from the message you received."}</p>
            <button type="button" className="cta" onClick={() => nav("/", { replace: true })}>Go to sign in</button>
          </>
        ) : !info ? <p className="mu">Checking your link…</p> : (
          <>
            <h2>{info.purpose === "invite" ? "Welcome! Set up your account" : "Choose a new password"}</h2>
            <p className="mu">Account: <b>{info.email}</b></p>
            {info.purpose === "invite" && (
              <label className="ff"><span className="mu">Your name</span><input value={shownName} onChange={(e) => setName(e.target.value)} required maxLength={200} /></label>
            )}
            <input type="email" autoComplete="username" value={info.email} readOnly hidden />
            <label className="ff"><span className="mu">New password (at least {PORTAL_PASSWORD_MIN} characters; a short sentence works well)</span>
              <input type="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} required />
            </label>
            {problem && <p className="err">{problem}</p>}
            <label className="ff"><span className="mu">Type it again</span><input type="password" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} required /></label>
            <button className="cta" disabled={busy || !!problem} style={{ width: "100%", marginTop: 6 }}>{busy ? "Saving…" : info.purpose === "invite" ? "Create my account" : "Save new password"}</button>
            {err && <p className="err">{err}</p>}
          </>
        )}
      </form>
    </Frame>
  );
}
