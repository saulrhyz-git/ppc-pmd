import { useState, type FormEvent, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PORTAL_PASSWORD_MIN, passwordProblem, type PortalMeDTO, type PortalSessionDTO } from "@pmd/shared";
import { papi } from "./api";
import { fmtWhen } from "./bits";
import { InstallButton, useInstall } from "../pwa";

/** Small helper: runs an async action and keeps its busy / error / done state. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const run = async (f: () => Promise<unknown>, ok = "") => {
    setBusy(true); setErr(""); setDone("");
    try { await f(); setDone(ok); return true; } catch (x) { setErr((x as Error).message); return false; } finally { setBusy(false); }
  };
  const Msg = () => <>{err && <p className="pp-err">{err}</p>}{done && <p className="pp-ok">{done}</p>}</>;
  return { busy, run, Msg };
}

function Section({ title, sub, right, children }: { title: string; sub?: ReactNode; right?: ReactNode; children: ReactNode }) {
  return (
    <section className="pp-card">
      <div className="pp-row"><h2>{title}</h2><span className="pp-sp" />{right}</div>
      {sub && <p className="mu">{sub}</p>}
      {children}
    </section>
  );
}

function Profile({ me, onChanged }: { me: PortalMeDTO; onChanged: () => void }) {
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone);
  const a = useAction();
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(() => papi.patch("/account/profile", { name, phone }), "Saved").then((ok) => ok && onChanged()); };
  return (
    <Section title="Your details" sub="So property management knows who you are and how to reach you about a request.">
      <form onSubmit={submit}>
        <label className="pp-f"><span>Email</span><input value={me.email} readOnly disabled /><small>To change your email, contact your property management office.</small></label>
        <label className="pp-f"><span>Name</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} autoComplete="name" /></label>
        <label className="pp-f"><span>Mobile number</span><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" autoComplete="tel" /></label>
        <button className="pp-btn sm" disabled={a.busy}>Save</button>
        <a.Msg />
      </form>
    </Section>
  );
}

function Password({ me }: { me: PortalMeDTO }) {
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const a = useAction();
  const problem = nw ? passwordProblem(nw, me.email, me.name) : null;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (problem) return;
    a.run(() => papi.post("/account/password", { current: cur, next: nw }), "Password changed. You were signed out on your other devices.").then((ok) => { if (ok) { setCur(""); setNw(""); } });
  };
  return (
    <Section title="Password">
      <form onSubmit={submit}>
        <input type="email" autoComplete="username" value={me.email} readOnly hidden />
        <label className="pp-f"><span>Current password</span><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
        <label className="pp-f"><span>New password</span><input type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} required /><small>At least {PORTAL_PASSWORD_MIN} characters.</small></label>
        {problem && <p className="pp-err">{problem}</p>}
        <button className="pp-btn sm" disabled={a.busy || !!problem}>Change password</button>
        <a.Msg />
      </form>
    </Section>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="pp-info" style={{ margin: "12px 0" }}>
      <p style={{ color: "var(--tx)" }}><b>Save these recovery codes somewhere safe.</b> Each one lets you sign in once if you lose your phone. They won’t be shown again.</p>
      <div className="pp-codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <button className="pp-link" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy codes</button>
    </div>
  );
}

function TwoStep({ me, onChanged }: { me: PortalMeDTO; onChanged: () => void }) {
  const [password, setPassword] = useState("");
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null);
  const [code, setCode] = useState("");
  const [codes, setCodes] = useState<string[] | null>(null);
  const a = useAction();

  const start = (e: FormEvent) => { e.preventDefault(); a.run(async () => { setSetup(await papi.post("/account/mfa/setup", { password })); setPassword(""); }); };
  const confirm = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => { const r = await papi.post<{ recoveryCodes: string[] }>("/account/mfa/enable", { code }); setCodes(r.recoveryCodes); setSetup(null); setCode(""); onChanged(); }, "Two-step sign-in is on. 🎉");
  };
  const disable = (e: FormEvent) => {
    e.preventDefault();
    a.run(async () => { await papi.post("/account/mfa/disable", { password, code }); setPassword(""); setCode(""); onChanged(); }, "Two-step sign-in is off.");
  };
  const newCodes = () => {
    if (!password) return;
    a.run(async () => { const r = await papi.post<{ recoveryCodes: string[] }>("/account/mfa/recovery-codes", { password }); setCodes(r.recoveryCodes); setPassword(""); });
  };

  return (
    <Section title="Two-step sign-in" right={<span className={"pp-badge " + (me.mfaEnabled ? "on" : "off")}>{me.mfaEnabled ? "✓ On" : "Off"}</span>}
      sub="Keeps your account safe even if someone learns your password. When you sign in, you also enter a code from an app on your phone, such as Google Authenticator, Microsoft Authenticator or Authy.">
      {me.mfaRequired && !me.mfaEnabled && <p className="pp-note">Your property management office asks everyone to turn this on. Set it up to see your units and requests.</p>}
      {codes && <RecoveryCodes codes={codes} />}
      {!me.mfaEnabled && !setup && (
        <form onSubmit={start}>
          <label className="pp-f"><span>Enter your password to begin</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="pp-btn sm" disabled={a.busy}>Set up two-step sign-in</button>
        </form>
      )}
      {setup && (
        <form onSubmit={confirm}>
          <ol style={{ paddingLeft: 20, lineHeight: 1.6 }}>
            <li>Open your authenticator app and add a new account. On this phone you can <a href={setup.otpauthUrl}>tap here to add it</a>. Otherwise choose “enter a setup key” and type:
              <code className="pp-key">{setup.secret.match(/.{1,4}/g)!.join(" ")}</code></li>
            <li>Type the 6-digit code the app shows.</li>
          </ol>
          <label className="pp-f"><span>6-digit code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.trim())} required style={{ letterSpacing: ".4em", fontSize: 20, maxWidth: 220 }} /></label>
          <div className="pp-row"><button className="pp-btn sm" disabled={a.busy}>Turn on</button><button type="button" className="pp-link" onClick={() => setSetup(null)}>Cancel</button></div>
        </form>
      )}
      {me.mfaEnabled && (
        <>
          <label className="pp-f"><span>Your password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /><small>Needed to get new recovery codes{me.mfaRequired ? "" : " or to turn two-step sign-in off"}.</small></label>
          <div className="pp-row">
            <button className="pp-btn sm soft" disabled={a.busy || !password} onClick={newCodes}>Get new recovery codes</button>
            {!me.mfaRequired && (
              <form onSubmit={disable} className="pp-row">
                <input inputMode="numeric" placeholder="6-digit code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.trim())} style={{ width: 150 }} />
                <button className="pp-link" disabled={a.busy || !password || code.length !== 6}>Turn off</button>
              </form>
            )}
          </div>
        </>
      )}
      <a.Msg />
    </Section>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["p-sessions"], queryFn: () => papi.get<PortalSessionDTO[]>("/account/sessions") });
  const a = useAction();
  return (
    <Section title="Where you’re signed in" sub="If you see a device you don’t recognise, sign it out and change your password."
      right={(q.data?.length ?? 0) > 1 && <button className="pp-link" disabled={a.busy} onClick={() => a.run(() => papi.post("/account/sessions/revoke-others"), "Your other devices were signed out.").then(() => qc.invalidateQueries({ queryKey: ["p-sessions"] }))}>Sign out other devices</button>}>
      {q.data?.map((s) => (
        <div key={s.id} className="pp-row" style={{ padding: "10px 0", borderTop: "1px solid var(--ln)" }}>
          <span style={{ fontSize: 22 }}>{/iPhone|Android/.test(s.userAgent) ? "📱" : "💻"}</span>
          <div style={{ flex: 1 }}><b>{s.userAgent}</b>{s.current && <span className="pp-tag or" style={{ marginLeft: 6 }}>This device</span>}<br /><span className="mu" style={{ fontSize: 12 }}>Last active {fmtWhen(s.lastSeenAt)} · signed in {fmtWhen(s.createdAt)}</span></div>
        </div>
      ))}
      <a.Msg />
    </Section>
  );
}

function InstallApp() {
  const inst = useInstall();
  if (inst.kind === "none") return null;
  return (
    <Section title="App on this phone" sub="Put My Portal on your home screen so it opens full screen, like a normal app.">
      <InstallButton className="pp-btn" />
    </Section>
  );
}

export default function Account({ me, onChanged }: { me: PortalMeDTO; onChanged: () => void }) {
  return (
    <>
      <div className="pp-sec" style={{ marginTop: 4 }}><h2 style={{ fontSize: 22 }}>Account & security</h2></div>
      <TwoStep me={me} onChanged={onChanged} />
      <Profile me={me} onChanged={onChanged} />
      <Password me={me} />
      <Sessions />
      <InstallApp />
    </>
  );
}
