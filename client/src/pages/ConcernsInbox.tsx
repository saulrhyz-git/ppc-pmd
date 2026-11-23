import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CONCERN_STATUS, type ConcernDTO } from "@pmd/shared";
import { api } from "../api";
import { Card, Pill, Sheet, Table } from "../ui";
import { fmtDate } from "./common";
import { useAuth } from "../auth";
import { NewWorkOrderSheet, WorkOrderSheet } from "./WorkOrders";

export const useConcerns = () => useQuery({ queryKey: ["concerns"], queryFn: () => api.get<ConcernDTO[]>("/concerns"), refetchInterval: 60_000 });

const stLevel = (s: string) => (s === "Sent" ? "r" : s === "Resolved" || s === "Closed" ? "g" : "a");
const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });

export function Attachments({ list }: { list: ConcernDTO["attachments"] }) {
  if (!list.length) return null;
  return (
    <div className="row" style={{ marginTop: 4 }}>
      {list.map((a) => (
        <a key={a.id} href={`/api/concerns/attachments/${a.id}`} target="_blank" rel="noreferrer">
          {a.mime.startsWith("image/") ? <img src={`/api/concerns/attachments/${a.id}`} alt={a.filename} style={{ height: 64, borderRadius: 6, border: "1px solid var(--ln)" }} /> : "📎 " + a.filename}
        </a>
      ))}
    </div>
  );
}

export function Thread({ c }: { c: ConcernDTO }) {
  return (
    <>
      <div className="msg tenant">
        <small>{c.createdByName} · {when(c.createdAt)}</small>
        <div style={{ whiteSpace: "pre-wrap" }}>{c.concern}</div>
        <Attachments list={c.attachments} />
      </div>
      {c.updates.map((u) =>
        u.kind === "status" ? (
          <p key={u.id} className="mu center" style={{ margin: "4px 0" }}>· {u.message} · {when(u.createdAt)}</p>
        ) : (
          <div key={u.id} className={"msg " + (u.authorRole === "Tenant" ? "tenant" : "staff")}>
            <small>{u.authorName} · {when(u.createdAt)}{u.kind === "followup" ? " · follow-up" : ""}</small>
            <div style={{ whiteSpace: "pre-wrap" }}>{u.message}</div>
            <Attachments list={u.attachments} />
          </div>
        ),
      )}
    </>
  );
}

function ConcernSheet({ c, onClose }: { c: ConcernDTO; onClose: () => void }) {
  const qc = useQueryClient();
  const [msg, setMsg] = useState("");
  const [status, setStatus] = useState<string>(c.status === "Sent" ? "Received" : c.status);
  const [err, setErr] = useState("");
  const refresh = () => { qc.invalidateQueries({ queryKey: ["concerns"] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const receive = useMutation({ mutationFn: () => api.post<ConcernDTO>(`/concerns/${c.id}/receive`), onSuccess: refresh, onError: (e) => setErr((e as Error).message) });
  const respond = useMutation({
    mutationFn: () => { const f = new FormData(); f.append("message", msg); f.append("status", status); return api.post<ConcernDTO>(`/concerns/${c.id}/updates`, f); },
    onSuccess: () => { setMsg(""); refresh(); }, onError: (e) => setErr((e as Error).message),
  });
  const cur = useConcerns().data?.find((x) => x.id === c.id) ?? c;
  const { user } = useAuth();
  const [newWo, setNewWo] = useState(false);
  const [woId, setWoId] = useState<string | null>(null);
  const canWo = !!user && (user.tabs.wos ?? 0) >= 2;
  return (
    <Sheet title={`${cur.controlNo} · ${cur.property}`} onClose={onClose}>
      <dl className="kv">
        <dt>Tenant</dt><dd>{cur.tenantName}</dd>
        <dt>Trade</dt><dd>{cur.trade}</dd>
        <dt>Location</dt><dd>{cur.location || "–"}</dd>
        <dt>Status</dt><dd><Pill level={stLevel(cur.status)}>{cur.status}</Pill></dd>
        <dt>Received</dt><dd>{cur.receivedAt ? `${when(cur.receivedAt)} by ${cur.receivedBy}` : "Not yet"}</dd>
      </dl>
      <h3>Conversation</h3>
      <Thread c={cur} />
      {(!cur.receivedAt || cur.unseenFollowups > 0) && (
        <button className="cta" style={{ margin: "8px 0" }} disabled={receive.isPending} onClick={() => receive.mutate()}>
          {cur.receivedAt ? "Mark follow-up as seen" : "Receive (logs a concern slip)"}
        </button>
      )}
      {cur.receivedAt && (
        <>
          <h3>Respond to tenant</h3>
          <textarea className="in" rows={3} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="What has been done, or what happens next" />
          <div className="row">
            <label className="mu">Status <select className="in" value={status} onChange={(e) => setStatus(e.target.value)}>{CONCERN_STATUS.filter((s) => s !== "Sent").map((s) => <option key={s}>{s}</option>)}</select></label>
            <span className="spacer" />
            <button className="cta" disabled={!msg.trim() || respond.isPending} onClick={() => respond.mutate()}>{respond.isPending ? "Sending…" : "Send response"}</button>
          </div>
          <p className="mu">Receiving creates a concern slip. Responding records the response time on that slip; Resolved sets the resolution time and Closed closes the slip.</p>
        </>
      )}
      {cur.receivedAt && canWo && (
        <p><button className="cta sm sec" onClick={() => setNewWo(true)}>+ Create work order for this concern</button></p>
      )}
      {err && <p className="err">{err}</p>}
      {newWo && <NewWorkOrderSheet buildings={[cur.property]} prefill={{ property: cur.property, title: cur.concern.slice(0, 120), description: cur.concern, trade: cur.trade, location: cur.location, tenant: cur.tenantName, reportedBy: cur.createdByName, concernId: cur.id }} onClose={() => setNewWo(false)} onCreated={(w) => setWoId(w.id)} />}
      {woId && <WorkOrderSheet id={woId} onClose={() => setWoId(null)} />}
    </Sheet>
  );
}

/** Staff inbox for concerns raised through the tenant portal. */
export function ConcernsInboxCard({ compact }: { compact?: boolean }) {
  const q = useConcerns();
  const [open, setOpen] = useState(!compact);
  const [sel, setSel] = useState<ConcernDTO | null>(null);
  const [filter, setFilter] = useState<"active" | "all">("active");
  const list = q.data ?? [];
  const needs = list.filter((c) => c.status === "Sent" || c.unseenFollowups > 0);
  if (compact && !needs.length) return null;
  const shown = compact ? needs : filter === "active" ? list.filter((c) => c.status !== "Closed") : list;
  return (
    <Card
      title={<button className="lnk" style={{ fontSize: 17, color: "var(--tx)" }} onClick={() => setOpen(!open)}>{open ? "▼" : "▶"} Concerns received through the tenant portal{needs.length ? <span className="badge">{needs.length}</span> : null}</button>}
      right={open && !compact ? <div className="tabs" style={{ margin: 0 }}><button className={filter === "active" ? "on" : ""} onClick={() => setFilter("active")}>Active</button><button className={filter === "all" ? "on" : ""} onClick={() => setFilter("all")}>All</button></div> : null}
    >
      {open && (
        <>
          {compact && <p className="mu">These tenant concerns are waiting to be received or have new follow-ups.</p>}
          {!shown.length ? <p className="mu">No concerns.</p> : (
            <Table head={["Control no.", "Building", "Tenant", "Trade", "Concern", "Sent", "Status"]}>
              {shown.map((c) => (
                <tr key={c.id} className="click" onClick={() => setSel(c)}>
                  <td>{c.controlNo}</td><td>{c.property}</td><td>{c.tenantName}</td><td>{c.trade}</td><td className="wrap">{c.concern.slice(0, 120)}</td><td>{fmtDate(c.createdAt.slice(0, 10))}</td>
                  <td><Pill level={stLevel(c.status)}>{c.status}</Pill>{c.unseenFollowups ? <span className="badge">{c.unseenFollowups} new</span> : null}</td>
                </tr>
              ))}
            </Table>
          )}
        </>
      )}
      {sel && <ConcernSheet c={sel} onClose={() => setSel(null)} />}
    </Card>
  );
}
