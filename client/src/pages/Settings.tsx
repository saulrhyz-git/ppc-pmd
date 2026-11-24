import { useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { defaultTabs, ROLE_NOTES, ROLES, TABS, THRESHOLD_LABELS, type Role, type TabAccess, type Thresholds } from "@pmd/shared";
import { api, type AdminUser } from "../api";
import { useMeta } from "../state";
import { useAuth } from "../auth";
import { Card, Sheet, Table } from "../ui";

function Fold({ title, children, open: o = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(o);
  return (
    <div className="card">
      <button className="lnk" style={{ fontSize: 17, color: "var(--tx)" }} onClick={() => setOpen(!open)}>{open ? "▼" : "▶"} {title}</button>
      {open && <div style={{ marginTop: 10 }}>{children}</div>}
    </div>
  );
}

type Draft = Omit<AdminUser, "id" | "lastLoginAt"> & { id?: string; password?: string };

function UserForm({ u, onClose }: { u: Draft; onClose: () => void }) {
  const meta = useMeta().data;
  const qc = useQueryClient();
  const [f, setF] = useState<Draft>(u);
  const [err, setErr] = useState("");
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setF((x) => ({ ...x, [k]: v }));
  const m = useMutation({
    mutationFn: () => {
      const body = { email: f.email, name: f.name, role: f.role, section: f.role === "Supervisor" ? f.section : null, properties: f.properties, canApprove: f.canApprove, active: f.active, tabs: f.tabs, password: f.password || undefined };
      return f.id ? api.put(`/users/${f.id}`, body) : api.post("/users", body);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["users"] }); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  const needsProps = f.role === "Admin/Engineer" || f.role === "Technician" || f.role === "Tenant";
  return (
    <Sheet title={f.id ? `Edit ${u.name}` : "Add user"} onClose={onClose}>
      <label className="ff"><span className="mu">Name</span><input value={f.name} onChange={(e) => set("name", e.target.value)} /></label>
      <label className="ff"><span className="mu">Email (used to sign in)</span><input type="email" value={f.email} onChange={(e) => set("email", e.target.value)} /></label>
      <label className="ff"><span className="mu">Role</span>
        <select value={f.role} onChange={(e) => { const r = e.target.value as Role; setF((x) => ({ ...x, role: r, tabs: defaultTabs(r) })); }}>{ROLES.map((r) => <option key={r}>{r}</option>)}</select>
      </label>
      <p className="mu">{ROLE_NOTES[f.role]}</p>
      {f.role === "Supervisor" && (
        <label className="ff"><span className="mu">Section</span><select value={f.section ?? ""} onChange={(e) => set("section", e.target.value || null)}><option value="">–</option>{meta?.sections.map((s) => <option key={s}>{s}</option>)}</select></label>
      )}
      {needsProps && (
        <div className="ff"><span className="mu">{f.role === "Tenant" ? "Tenant's building(s)" : "Buildings"}</span>
          <div className="row">{meta?.properties.map((p) => (
            <label key={p.id} className="row" style={{ gap: 4 }}><input type="checkbox" checked={f.properties.includes(p.name)} onChange={(e) => set("properties", e.target.checked ? [...f.properties, p.name] : f.properties.filter((x) => x !== p.name))} />{p.name}</label>
          ))}</div>
        </div>
      )}
      {f.role !== "Tenant" && (
        <>
          <label className="row" style={{ margin: "8px 0" }}><input type="checkbox" checked={f.canApprove} onChange={(e) => set("canApprove", e.target.checked)} /> Can approve</label>
          <div className="ff"><span className="mu">Screen access</span>
            <Table head={["Screen", "Access"]}>
              {TABS.filter(([k]) => k !== "set").map(([k, l]) => (
                <tr key={k}><td>{l}</td><td>
                  <select className="in" value={f.tabs[k] ?? 0} onChange={(e) => set("tabs", { ...f.tabs, [k]: +e.target.value as 0 | 1 | 2 } as TabAccess)}>
                    <option value={0}>Hidden</option><option value={1}>View</option>{k === "data" && <option value={2}>View and edit</option>}
                  </select>
                </td></tr>
              ))}
            </Table>
          </div>
        </>
      )}
      <label className="row" style={{ margin: "8px 0" }}><input type="checkbox" checked={f.active} onChange={(e) => set("active", e.target.checked)} /> Active (can sign in)</label>
      <label className="ff"><span className="mu">{f.id ? "Reset password (leave blank to keep)" : "Starting password (at least 8 characters)"}</span><input type="password" autoComplete="new-password" value={f.password ?? ""} onChange={(e) => set("password", e.target.value)} /></label>
      <button className="cta" disabled={m.isPending} onClick={() => m.mutate()}>{m.isPending ? "Saving…" : "Save"}</button>
      {err && <p className="err">{err}</p>}
    </Sheet>
  );
}

function Users() {
  const q = useQuery({ queryKey: ["users"], queryFn: () => api.get<AdminUser[]>("/users") });
  const [edit, setEdit] = useState<Draft | null>(null);
  return (
    <>
      <div className="row"><span className="spacer" /><button className="cta sm" onClick={() => setEdit({ email: "", name: "", role: "Admin/Engineer", section: null, properties: [], canApprove: false, active: true, tabs: defaultTabs("Admin/Engineer") })}>+ Add user</button></div>
      <Table head={["Name", "Email", "Role", "Scope", "Approve", "Active", "Last sign-in"]}>
        {(q.data ?? []).map((u) => (
          <tr key={u.id} className="click" onClick={() => setEdit({ ...u })}>
            <td><b>{u.name}</b></td><td>{u.email}</td><td>{u.role}</td><td>{u.role === "Supervisor" ? u.section || "–" : u.properties.length ? u.properties.join(", ") : u.role === "General Manager" || u.role === "Department Head" ? "All buildings" : "–"}</td>
            <td>{u.canApprove ? "Yes" : "No"}</td><td>{u.active ? "Yes" : <span className="err">No</span>}</td><td>{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString("en-GB") : "Never"}</td>
          </tr>
        ))}
      </Table>
      {edit && <UserForm u={edit} onClose={() => setEdit(null)} />}
    </>
  );
}

function Buildings() {
  const meta = useMeta();
  const qc = useQueryClient();
  const [sec, setSec] = useState("");
  const [err, setErr] = useState("");
  const done = () => { setErr(""); qc.invalidateQueries({ queryKey: ["meta"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const addSec = useMutation({ mutationFn: () => api.post("/sections", { name: sec }), onSuccess: () => { setSec(""); done(); }, onError: (e) => setErr((e as Error).message) });
  const upd = useMutation({ mutationFn: (p: { id: string; section: string | null; scoreRed: number; scoreAmber: number }) => api.put(`/properties/${p.id}`, p), onSuccess: done, onError: (e) => setErr((e as Error).message) });
  const m = meta.data;
  if (!m) return null;
  return (
    <>
      <Table head={["Building", "Section", "Red points", "Amber points"]}>
        {m.properties.map((p) => (
          <tr key={p.id}>
            <td><b>{p.name}</b></td>
            <td><select className="in" value={p.section ?? ""} onChange={(e) => upd.mutate({ ...p, section: e.target.value || null })}><option value="">Unassigned</option>{m.sections.map((s) => <option key={s}>{s}</option>)}</select></td>
            <td><input className="in" type="number" min={0} max={20} style={{ width: 70 }} defaultValue={p.scoreRed} onBlur={(e) => +e.target.value !== p.scoreRed && upd.mutate({ ...p, scoreRed: +e.target.value })} /></td>
            <td><input className="in" type="number" min={0} max={20} style={{ width: 70 }} defaultValue={p.scoreAmber} onBlur={(e) => +e.target.value !== p.scoreAmber && upd.mutate({ ...p, scoreAmber: +e.target.value })} /></td>
          </tr>
        ))}
      </Table>
      <p className="mu">To add a building or change its details, go to <Link to="/configuration?s=buildings">Configuration, Buildings</Link>.</p>
      <h3>Add a section</h3>
      <div className="row">
        <input className="in" placeholder="Section name" value={sec} onChange={(e) => setSec(e.target.value)} />
        <button className="cta sm" disabled={!sec.trim()} onClick={() => addSec.mutate()}>Add section</button>
      </div>
      {err && <p className="err">{err}</p>}
    </>
  );
}

function ThresholdsForm() {
  const meta = useMeta();
  const qc = useQueryClient();
  const [t, setT] = useState<Thresholds | null>(null);
  const [ok, setOk] = useState("");
  const cur = t ?? meta.data?.thresholds;
  const m = useMutation({ mutationFn: () => api.put<Thresholds>("/settings/thresholds", cur), onSuccess: () => { setOk("Saved. Dashboards are updated."); setT(null); qc.invalidateQueries({ queryKey: ["meta"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); } });
  if (!cur) return null;
  const set = (k: keyof Thresholds, kk: string, v: number) => setT({ ...cur, [k]: { ...cur[k], [kk]: v } });
  return (
    <>
      <div className="w thr">
        <table>
          <thead><tr><th>Metric</th><th>Amber at</th><th>Red at</th></tr></thead>
          <tbody>
            {(Object.keys(THRESHOLD_LABELS) as (keyof Thresholds)[]).map((k) => (
              <tr key={k}>
                <td>{THRESHOLD_LABELS[k]}</td>
                <td><input type="number" step="any" value={(cur[k] as Record<string, number>).a} onChange={(e) => set(k, "a", +e.target.value)} /></td>
                <td>{"r" in cur[k] ? <input type="number" step="any" value={(cur[k] as Record<string, number>).r} onChange={(e) => set(k, "r", +e.target.value)} /> : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <button className="cta" style={{ marginTop: 8 }} disabled={!t || m.isPending} onClick={() => m.mutate()}>Save targets</button>
      {ok && <p className="okmsg">{ok}</p>}
    </>
  );
}

function AsOf() {
  const meta = useMeta();
  const qc = useQueryClient();
  const [v, setV] = useState("");
  const m = useMutation({ mutationFn: (asOf: string | null) => api.put("/settings/as-of", { asOf }), onSuccess: () => { setV(""); qc.invalidateQueries({ queryKey: ["meta"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); } });
  return (
    <>
      <p className="mu">Dashboards report on the last complete month before the as-of date. Leave it on today unless you are reviewing an earlier period. Currently {meta.data?.asOf}.</p>
      <div className="row">
        <input className="in" type="date" value={v} onChange={(e) => setV(e.target.value)} />
        <button className="cta sm" disabled={!v} onClick={() => m.mutate(v)}>Set as-of date</button>
        <button className="lnk" onClick={() => m.mutate(null)}>Use today</button>
      </div>
    </>
  );
}

function History() {
  const q = useQuery({ queryKey: ["audit"], queryFn: () => api.get<{ id: string; userName: string | null; action: string; detail: unknown; createdAt: string }[]>("/audit") });
  return (
    <Table head={["When", "Who", "What", "Detail"]}>
      {(q.data ?? []).map((a) => <tr key={a.id}><td>{new Date(a.createdAt).toLocaleString("en-GB")}</td><td>{a.userName || "–"}</td><td>{a.action}</td><td className="wrap"><code>{a.detail ? JSON.stringify(a.detail).slice(0, 200) : ""}</code></td></tr>)}
    </Table>
  );
}

export function PasswordForm() {
  const [cur, setCur] = useState("");
  const [nw, setNw] = useState("");
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const m = useMutation({ mutationFn: () => api.post("/auth/password", { current: cur, next: nw }), onSuccess: () => { setCur(""); setNw(""); setMsg({ ok: "Password changed." }); }, onError: (e) => setMsg({ err: (e as Error).message }) });
  return (
    <div className="row">
      <input className="in" type="password" placeholder="Current password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} />
      <input className="in" type="password" placeholder="New password (8+ characters)" autoComplete="new-password" value={nw} onChange={(e) => setNw(e.target.value)} />
      <button className="cta sm" disabled={!cur || nw.length < 8} onClick={() => m.mutate()}>Change password</button>
      {msg.ok && <span className="okmsg">{msg.ok}</span>}{msg.err && <span className="err">{msg.err}</span>}
    </div>
  );
}

export default function Settings() {
  const { user } = useAuth();
  const isDH = user?.role === "Department Head";
  return (
    <>
      <Card title="Settings" sub={isDH ? "Only the Department Head can change these. Every change is logged under Change history." : "Your account."} />
      <Fold title="My password" open={!isDH}><PasswordForm /></Fold>
      {isDH && (
        <>
          <Fold title="Users & access" open><Users /></Fold>
          <Fold title="Buildings, sections & scoring"><Buildings /></Fold>
          <Fold title="Metrics & targets (Red / Amber)"><ThresholdsForm /></Fold>
          <Fold title="As-of date"><AsOf /></Fold>
          <Fold title="Change history"><History /></Fold>
        </>
      )}
    </>
  );
}
