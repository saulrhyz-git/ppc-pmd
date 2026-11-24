import { useState, type FormEvent } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { PORTAL_PASSWORD_MIN, passwordProblem, type PortalMeDTO, type PortalSessionDTO } from "@pmd/shared";
import { Card } from "../ui";
import { papi } from "./api";
import { fmtWhen } from "./bits";

/** Small helper: runs an async action and keeps its busy / error / done state. */
function useAction() {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const [done, setDone] = useState("");
  const run = async (f: () => Promise<unknown>, ok = "") => {
    setBusy(true); setErr(""); setDone("");
    try { await f(); setDone(ok); return true; } catch (x) { setErr((x as Error).message); return false; } finally { setBusy(false); }
  };
  const Msg = () => <>{err && <p className="err">{err}</p>}{done && <p className="ok">{done}</p>}</>;
  return { busy, run, Msg };
}

function Profile({ me, onChanged }: { me: PortalMeDTO; onChanged: () => void }) {
  const [name, setName] = useState(me.name);
  const [phone, setPhone] = useState(me.phone);
  const a = useAction();
  const submit = (e: FormEvent) => { e.preventDefault(); a.run(() => papi.patch("/account/profile", { name, phone }), "Saved").then((ok) => ok && onChanged()); };
  return (
    <Card title="Contact details">
      <form onSubmit={submit}>
        <label className="ff"><span className="mu">Email (ask property management to change it)</span><input value={me.email} readOnly disabled /></label>
        <label className="ff"><span className="mu">Name</span><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={200} /></label>
        <label className="ff"><span className="mu">Mobile number (so we can reach you about a request)</span><input value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={40} inputMode="tel" /></label>
        <button className="cta sec" disabled={a.busy}>Save</button>
        <a.Msg />
      </form>
    </Card>
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
    a.run(() => papi.post("/account/password", { current: cur, next: nw }), "Password changed. Other devices were signed out.").then((ok) => { if (ok) { setCur(""); setNw(""); } });
  };
  return (
    <Card title="Password">
      <form onSubmit={submit}>
        <input type="email" autoComplete="username" value={me.email} readOnly hidden />
        <label className="ff"><span className="mu">Current password</span><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} required /></label>
        <label className="ff"><span className="mu">New password (at least {PORTAL_PASSWORD_MIN} characters)</span><input type="password" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} required /></label>
        {problem && <p className="err">{problem}</p>}
        <button className="cta sec" disabled={a.busy || !!problem}>Change password</button>
        <a.Msg />
      </form>
    </Card>
  );
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <>
      <p><b>Save these recovery codes now.</b> Each one signs you in once if you lose your phone. They will not be shown again.</p>
      <div className="codes">{codes.map((c) => <span key={c}>{c}</span>)}</div>
      <button className="lnk" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(codes.join("\n"))}>Copy codes</button>
    </>
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
    a.run(async () => { const r = await papi.post<{ recoveryCodes: string[] }>("/account/mfa/enable", { code }); setCodes(r.recoveryCodes); setSetup(null); setCode(""); onChanged(); }, "Two-step sign-in is on.");
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
    <Card title="Two-step sign-in" sub="Protects your account even if someone learns your password: signing in also needs a code from an app on your phone (Google Authenticator, Microsoft Authenticator, 1Password, Authy and similar).">
      {me.mfaRequired && !me.mfaEnabled && <p className="err">Property management requires two-step sign-in. Set it up to see your units and requests.</p>}
      {codes && <RecoveryCodes codes={codes} />}
      {!me.mfaEnabled && !setup && (
        <form onSubmit={start}>
          <label className="ff"><span className="mu">Confirm your password to start</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="cta" disabled={a.busy}>Set up two-step sign-in</button>
        </form>
      )}
      {setup && (
        <form onSubmit={confirm}>
          <ol>
            <li>Open your authenticator app and add an account. On this phone you can <a href={setup.otpauthUrl}>tap here to add it</a>; otherwise choose “enter a setup key” and type:
              <code className="key">{setup.secret.match(/.{1,4}/g)!.join(" ")}</code></li>
            <li>Enter the 6-digit code the app shows.</li>
          </ol>
          <label className="ff"><span className="mu">Code</span><input inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.trim())} required /></label>
          <button className="cta" disabled={a.busy}>Turn on</button>{" "}
          <button type="button" className="lnk" onClick={() => setSetup(null)}>Cancel</button>
        </form>
      )}
      {me.mfaEnabled && (
        <>
          <p className="ok">Two-step sign-in is on.</p>
          <label className="ff"><span className="mu">Password (to turn off or to get new recovery codes)</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
          <div className="row">
            <button className="cta sec" disabled={a.busy || !password} onClick={newCodes}>New recovery codes</button>
            {!me.mfaRequired && (
              <form onSubmit={disable} className="row">
                <input inputMode="numeric" placeholder="6-digit code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.trim())} style={{ width: 130, padding: 9, borderRadius: 8, border: "1px solid var(--ln)" }} />
                <button className="lnk" disabled={a.busy || !password || code.length !== 6}>Turn off</button>
              </form>
            )}
          </div>
        </>
      )}
      <a.Msg />
    </Card>
  );
}

function Sessions() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["p-sessions"], queryFn: () => papi.get<PortalSessionDTO[]>("/account/sessions") });
  const a = useAction();
  return (
    <Card title="Where you are signed in" right={(q.data?.length ?? 0) > 1 && <button className="lnk" disabled={a.busy} onClick={() => a.run(() => papi.post("/account/sessions/revoke-others"), "Other devices were signed out.").then(() => qc.invalidateQueries({ queryKey: ["p-sessions"] }))}>Sign out other devices</button>}>
      {q.data?.map((s) => (
        <p key={s.id} style={{ margin: "6px 0" }}>{s.userAgent}{s.current && <b> (this device)</b>}<br /><span className="mu">Signed in {fmtWhen(s.createdAt)} · last active {fmtWhen(s.lastSeenAt)} · {s.ip}</span></p>
      ))}
      <a.Msg />
    </Card>
  );
}

export default function Account({ me, onChanged }: { me: PortalMeDTO; onChanged: () => void }) {
  return (
    <>
      <TwoStep me={me} onChanged={onChanged} />
      <Password me={me} />
      <Profile me={me} onChanged={onChanged} />
      <Sessions />
    </>
  );
}
