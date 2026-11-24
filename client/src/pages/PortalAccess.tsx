// Staff screen: invite unit owners and tenants to the owner / tenant portal and manage their access.
import { useState, type FormEvent } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { PORTAL_RELATIONS, PORTAL_RELATION_NOTES, type PortalAccessDTO, type PortalAccountAdminDTO, type PortalLinkDTO, type PortalRelation } from "@pmd/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { Card, Sheet, Table } from "../ui";
import { fmtDate } from "./common";

interface UnitRow { id: string; code: string; kind: string; floor: string; building: string; occupancy: string; ownerName: string; tenantName: string; status: string; portalAccounts: number }

const stateLevel = (s: PortalAccountAdminDTO["state"]) => (s === "Active" ? "g" : s === "Invited" ? "a" : "r");
const when = (s: string | null) => (s ? new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Never");

function LinkBox({ link, purpose }: { link: PortalLinkDTO; purpose: "invite" | "reset" }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card" style={{ background: "var(--ab)" }}>
      <b>{purpose === "invite" ? "Invitation link" : "Password reset link"}</b>
      <p className="mu">Send this link to the person yourself (email or message). It works once and expires {when(link.expiresAt)}. It is shown only now; make a new one if it gets lost.</p>
      <code style={{ display: "block", fontSize: 12, padding: 8, background: "var(--card)", borderRadius: 8 }}>{link.url}</code>
      <button className="cta sm" style={{ marginTop: 8 }} onClick={() => navigator.clipboard?.writeText(link.url).then(() => setCopied(true))}>{copied ? "Copied" : "Copy link"}</button>
    </div>
  );
}

function AccessFields({ v, set }: { v: { relation: PortalRelation; canRequest: boolean; seeAllRequests: boolean; endsOn: string }; set: (p: Partial<typeof v>) => void }) {
  return (
    <>
      <label className="ff"><span className="mu">Relation to the unit</span>
        <select value={v.relation} onChange={(e) => { const r = e.target.value as PortalRelation; set({ relation: r, seeAllRequests: r === "Owner" }); }}>
          {PORTAL_RELATIONS.map((r) => <option key={r}>{r}</option>)}
        </select>
        <span className="mu">{PORTAL_RELATION_NOTES[v.relation]}</span>
      </label>
      <label className="row"><input type="checkbox" checked={v.canRequest} onChange={(e) => set({ canRequest: e.target.checked })} /> Can file job requests and send messages</label>
      <label className="row"><input type="checkbox" checked={v.seeAllRequests} onChange={(e) => set({ seeAllRequests: e.target.checked })} /> Sees requests other people filed for this unit</label>
      <label className="ff"><span className="mu">Access ends on (optional, e.g. lease end)</span><input type="date" value={v.endsOn} onChange={(e) => set({ endsOn: e.target.value })} /></label>
    </>
  );
}

function InviteSheet({ units, unitId, onClose }: { units: UnitRow[]; unitId: string; onClose: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ email: "", name: "", phone: "", unitId: unitId || units[0]?.id || "", relation: "Tenant" as PortalRelation, canRequest: true, seeAllRequests: false, endsOn: "" });
  const [res, setRes] = useState<{ account: PortalAccountAdminDTO; link: PortalLinkDTO | null } | null>(null);
  const [err, setErr] = useState("");
  const m = useMutation({
    mutationFn: () => api.post<{ account: PortalAccountAdminDTO; link: PortalLinkDTO | null }>("/portal-admin/invite", { ...f, endsOn: f.endsOn || null }),
    onSuccess: (r) => { setRes(r); qc.invalidateQueries({ queryKey: ["portal-admin"] }); },
    onError: (e) => setErr((e as Error).message),
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setErr(""); m.mutate(); };
  return (
    <Sheet title="Invite to the portal" onClose={onClose}>
      {res ? (
        <>
          <p><b>{res.account.name}</b> ({res.account.email}) now has access to the unit.</p>
          {res.link ? <LinkBox link={res.link} purpose="invite" /> : <p className="mu">They already have a portal account, so no new link is needed. The unit appears the next time they open the portal.</p>}
          <button className="cta sec" onClick={onClose}>Done</button>
        </>
      ) : (
        <form onSubmit={submit}>
          <label className="ff"><span className="mu">Unit or space</span>
            <select value={f.unitId} onChange={(e) => setF({ ...f, unitId: e.target.value })}>{units.map((u) => <option key={u.id} value={u.id}>{u.building} · {u.code} ({u.kind})</option>)}</select>
          </label>
          <label className="ff"><span className="mu">Email</span><input type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required /></label>
          <label className="ff"><span className="mu">Name</span><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={200} /></label>
          <label className="ff"><span className="mu">Mobile (optional)</span><input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} maxLength={40} /></label>
          <AccessFields v={f} set={(p) => setF({ ...f, ...p })} />
          <button className="cta" disabled={m.isPending || !f.unitId}>{m.isPending ? "Saving…" : "Invite"}</button>
          {err && <p className="err">{err}</p>}
        </form>
      )}
    </Sheet>
  );
}

function AccessRow({ x, canWrite, onSaved }: { x: PortalAccessDTO; canWrite: boolean; onSaved: (a: PortalAccountAdminDTO) => void }) {
  const [edit, setEdit] = useState(false);
  const [v, setV] = useState({ relation: x.relation, canRequest: x.canRequest, seeAllRequests: x.seeAllRequests, endsOn: x.endsOn ?? "" });
  const [err, setErr] = useState("");
  const save = useMutation({
    mutationFn: () => api.patch<PortalAccountAdminDTO>(`/portal-admin/access/${x.id}`, { ...v, endsOn: v.endsOn || null }),
    onSuccess: (a) => { setEdit(false); onSaved(a); }, onError: (e) => setErr((e as Error).message),
  });
  const toggle = useMutation({
    mutationFn: () => api.post<PortalAccountAdminDTO>(`/portal-admin/access/${x.id}/${x.revokedAt ? "restore" : "revoke"}`),
    onSuccess: onSaved, onError: (e) => setErr((e as Error).message),
  });
  const expired = x.endsOn && x.endsOn < new Date().toISOString().slice(0, 10);
  return (
    <div className="er" style={{ cursor: "default", opacity: x.revokedAt ? 0.6 : 1 }}>
      <b>{x.building} · {x.unitCode} — {x.relation}</b>
      <span className="mu">
        {x.revokedAt ? `Revoked ${when(x.revokedAt)}` : expired ? `Ended ${fmtDate(x.endsOn!)}` : x.endsOn ? `Until ${fmtDate(x.endsOn)}` : "No end date"}
        {" · "}{x.canRequest ? "can file requests" : "view only"}{" · "}{x.seeAllRequests ? "sees all unit requests" : "sees own requests"}
        {x.grantedByName ? ` · granted by ${x.grantedByName}` : ""}
      </span>
      {edit ? (
        <>
          <AccessFields v={v} set={(p) => setV({ ...v, ...p })} />
          <button className="cta sm" disabled={save.isPending} onClick={() => save.mutate()}>Save</button>{" "}
          <button className="lnk" onClick={() => setEdit(false)}>Cancel</button>
        </>
      ) : canWrite && (
        <div className="row" style={{ marginTop: 6 }}>
          {!x.revokedAt && <button className="lnk" onClick={() => setEdit(true)}>Change</button>}
          <button className="lnk" disabled={toggle.isPending} onClick={() => (x.revokedAt || window.confirm(`Remove access to ${x.unitCode}? The person stops seeing this unit at once.`)) && toggle.mutate()}>{x.revokedAt ? "Restore access" : "Revoke access"}</button>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function AccountSheet({ initial, canWrite, onClose }: { initial: PortalAccountAdminDTO; canWrite: boolean; onClose: () => void }) {
  const qc = useQueryClient();
  const [a, setA] = useState(initial);
  const [link, setLink] = useState<{ purpose: "invite" | "reset"; link: PortalLinkDTO } | null>(null);
  const [err, setErr] = useState("");
  const saved = (x: PortalAccountAdminDTO) => { setA(x); qc.invalidateQueries({ queryKey: ["portal-admin"] }); };
  const act = useMutation({
    mutationFn: (name: string) => api.post<PortalAccountAdminDTO>(`/portal-admin/accounts/${a.id}/${name}`),
    onSuccess: saved, onError: (e) => setErr((e as Error).message),
  });
  const mkLink = useMutation({
    mutationFn: () => api.post<{ purpose: "invite" | "reset"; link: PortalLinkDTO }>(`/portal-admin/accounts/${a.id}/link`),
    onSuccess: setLink, onError: (e) => setErr((e as Error).message),
  });
  const confirmAct = (name: string, q: string) => window.confirm(q) && act.mutate(name);
  return (
    <Sheet title={a.name} onClose={onClose}>
      <p><span className={"pill " + stateLevel(a.state)}>{a.state}</span> <span className="mu">{a.email}{a.phone ? " · " + a.phone : ""}</span></p>
      <p className="mu">Two-step sign-in: {a.mfaEnabled ? "on" : "off"} · Last sign-in: {when(a.lastLoginAt)} · Invited {when(a.createdAt)}</p>
      {link && <LinkBox link={link.link} purpose={link.purpose} />}
      {canWrite && (
        <div className="row" style={{ margin: "8px 0" }}>
          {a.state !== "Disabled" && <button className="cta sm" disabled={mkLink.isPending} onClick={() => mkLink.mutate()}>{a.state === "Invited" ? "New invitation link" : "Password reset link"}</button>}
          {a.state === "Locked" && <button className="lnk" onClick={() => act.mutate("unlock")}>Unlock</button>}
          {a.state !== "Invited" && a.state !== "Disabled" && <button className="lnk" onClick={() => confirmAct("sign-out", "Sign this person out on every device?")}>Sign out everywhere</button>}
          {a.mfaEnabled && <button className="lnk" onClick={() => confirmAct("reset-mfa", "Turn off two-step sign-in (for a lost phone)? Only do this after confirming who you are talking to.")}>Reset two-step sign-in</button>}
          {a.state === "Disabled"
            ? <button className="lnk" onClick={() => act.mutate("enable")}>Enable account</button>
            : <button className="lnk" style={{ color: "var(--r)" }} onClick={() => confirmAct("disable", "Disable this account? The person is signed out at once and cannot sign in.")}>Disable account</button>}
        </div>
      )}
      {err && <p className="err">{err}</p>}
      <h3>Units</h3>
      {a.access.length ? a.access.map((x) => <AccessRow key={x.id} x={x} canWrite={canWrite} onSaved={saved} />) : <p className="mu">No units in your buildings.</p>}
    </Sheet>
  );
}

export default function PortalAccess() {
  const { user } = useAuth();
  const canWrite = (user?.tabs.prt ?? 0) >= 2;
  const [params, setParams] = useSearchParams();
  const unitId = params.get("unitId") ?? "";
  const [building, setBuilding] = useState("");
  const [search, setSearch] = useState("");
  const [inviting, setInviting] = useState(false);
  const [sel, setSel] = useState<PortalAccountAdminDTO | null>(null);
  const units = useQuery({ queryKey: ["portal-admin", "units"], queryFn: () => api.get<UnitRow[]>("/portal-admin/units") });
  const accounts = useQuery({
    queryKey: ["portal-admin", "accounts", unitId, building, search],
    queryFn: () => api.get<PortalAccountAdminDTO[]>(`/portal-admin/accounts?${new URLSearchParams({ ...(unitId ? { unitId } : {}), ...(building ? { property: building } : {}), ...(search ? { q: search } : {}) })}`),
  });
  const buildings = [...new Set((units.data ?? []).map((u) => u.building))];
  const shownUnits = (units.data ?? []).filter((u) => (!building || u.building === building) && u.status === "Active");
  const unit = units.data?.find((u) => u.id === unitId);
  return (
    <>
      <Card title="Owner & tenant portal" sub="Invite unit owners, tenants and their representatives. They sign in at /portal with their own password (and optional two-step code), and only see the units you give them. Their job requests arrive in the Concerns inbox."
        right={canWrite && shownUnits.length > 0 && <button className="cta sm" onClick={() => setInviting(true)}>+ Invite</button>}>
        <div className="bar">
          <select value={building} onChange={(e) => { setBuilding(e.target.value); setParams({}); }}>
            <option value="">All my buildings</option>
            {buildings.map((b) => <option key={b}>{b}</option>)}
          </select>
          <input placeholder="Search name or email" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1, minWidth: 160, padding: 8, borderRadius: 8, border: "1px solid var(--ln)", background: "var(--card)", color: "var(--tx)" }} />
        </div>
        {unit && <p>Showing unit <b>{unit.building} · {unit.code}</b> <button className="lnk" onClick={() => setParams({})}>Show all</button></p>}
      </Card>
      <Card title="Portal accounts">
        {accounts.isLoading ? <p className="mu">Loading…</p> : accounts.isError ? <p className="err">{(accounts.error as Error).message}</p> : !accounts.data?.length ? <p className="mu">No portal accounts yet.</p> : (
          <Table head={["Name", "Email", "Units", "Status", "Two-step", "Last sign-in"]}>
            {accounts.data.map((a) => (
              <tr key={a.id} className="click" onClick={() => setSel(a)}>
                <td>{a.name}</td><td>{a.email}</td>
                <td className="wrap">{a.access.filter((x) => !x.revokedAt).map((x) => `${x.unitCode} (${x.relation})`).join(", ") || "—"}</td>
                <td><span className={"pill " + stateLevel(a.state)}>{a.state}</span></td><td>{a.mfaEnabled ? "On" : "Off"}</td><td>{when(a.lastLoginAt)}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      <Card title="Units" sub={!units.isLoading && !shownUnits.length ? "No units are set up for your buildings yet. Add them under Configuration, Units & spaces." : undefined}>
        {shownUnits.length > 0 && (
          <Table head={["Building", "Unit", "Kind", "Occupancy", "Owner / tenant on file", "Portal accounts"]}>
            {shownUnits.map((u) => (
              <tr key={u.id} className="click" onClick={() => setParams({ unitId: u.id })}>
                <td>{u.building}</td><td>{u.code}</td><td>{u.kind}</td><td>{u.occupancy}</td><td className="wrap">{[u.ownerName, u.tenantName].filter(Boolean).join(" / ") || "—"}</td><td>{u.portalAccounts}</td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
      {inviting && <InviteSheet units={shownUnits} unitId={unitId} onClose={() => setInviting(false)} />}
      {sel && <AccountSheet initial={sel} canWrite={canWrite} onClose={() => setSel(null)} />}
    </>
  );
}
