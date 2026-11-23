import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";
import { ThemeButton } from "../Layout";

export default function Login() {
  const { login } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(email, password);
    } catch (x) {
      setErr(x instanceof Error ? x.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <header>
        <div className="top">
          <div>
            <h1>PPC <b>Property Management</b> System</h1>
            <small>PMD</small>
          </div>
          <ThemeButton />
        </div>
      </header>
      <main>
        <form className="card" style={{ maxWidth: 420, margin: "30px auto" }} onSubmit={submit}>
          <h2>Sign in</h2>
          <p className="mu">Staff and tenants sign in with the email and password given by the Department Head.</p>
          <label className="ff"><span className="mu">Email</span><input type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required /></label>
          <label className="ff"><span className="mu">Password</span><input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required /></label>
          <button className="cta" disabled={busy} style={{ width: "100%", marginTop: 6 }}>{busy ? "Signing in…" : "Sign in"}</button>
          {err && <p className="err">{err}</p>}
        </form>
      </main>
    </>
  );
}
