import { Fragment, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ACTIVITY_TYPES, TRADES, WO_NEEDS_NOTE, WO_PRIORITIES, WO_STATUS_NOTES, WO_STATUSES,
  allowedMoves, canAssign, canEditDetails, canEditWorkNotes,
  type SessionUser, type WoStatus, type WoUserRef, type WorkOrderDTO,
} from "@pmd/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { useFilter } from "../state";
import { Card, ErrorBox, Sheet, Table } from "../ui";
import { fmtDate } from "./common";

const slug = (s: string) => s.toLowerCase().replace(/[^a-z]+/g, "-");
export const StatusPill = ({ s }: { s: string }) => <span className={"pill st-" + slug(s)}>{s}</span>;
const PrioPill = ({ p }: { p: string }) => (p === "Urgent" || p === "High" ? <span className={"pill " + (p === "Urgent" ? "r" : "a")}>{p}</span> : <span className="mu">{p}</span>);
const when = (s: string) => new Date(s).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const today = () => new Date().toISOString().slice(0, 10);
const addDays = (d: string, n: number) => new Date(new Date(d + "T00:00:00Z").getTime() + n * 864e5).toISOString().slice(0, 10);
const canWrite = (u: SessionUser | null) => !!u && (u.tabs.wos ?? 0) >= 2;
const isOpen = (s: WoStatus) => s !== "Closed" && s !== "Cancelled";

/** Verb shown on the button that moves a work order to a status. */
const MOVE_LABEL: Record<WoStatus, (from: WoStatus) => string> = {
  New: () => "Reopen",
  Assigned: () => "Mark assigned",
  "In Progress": (f) => (f === "On Hold" ? "Resume work" : f === "Completed" || f === "Closed" ? "Reopen (more work needed)" : "Start work"),
  "On Hold": () => "Put on hold",
  Completed: () => "Mark completed",
  Closed: () => "Verify and close",
  Cancelled: () => "Cancel work order",
};

const FILTERS = [["open", "Open"], ["mine", "Assigned to me"], ...WO_STATUSES.map((s) => [s, s]), ["all", "All"]] as const;

export function useWorkOrder(id: string) {
  return useQuery({ queryKey: ["wo", id], queryFn: () => api.get<WorkOrderDTO>(`/work-orders/${id}`) });
}

function useRefresh() {
  const qc = useQueryClient();
  return (w?: WorkOrderDTO) => {
    if (w) qc.setQueryData(["wo", w.id], w);
    qc.invalidateQueries({ queryKey: ["wos"] });
    qc.invalidateQueries({ queryKey: ["dashboard"] });
    qc.invalidateQueries({ queryKey: ["concerns"] });
  };
}

// ---------------- create ----------------
export interface WoPrefill { property?: string; title?: string; description?: string; trade?: string; location?: string; tenant?: string; reportedBy?: string; concernId?: string }

export function NewWorkOrderSheet({ prefill, buildings, onClose, onCreated }: { prefill?: WoPrefill; buildings: string[]; onClose: () => void; onCreated?: (w: WorkOrderDTO) => void }) {
  const { user } = useAuth();
  const refresh = useRefresh();
  const [f, setF] = useState({
    property: prefill?.property || buildings[0] || "", title: prefill?.title || "", description: prefill?.description || "",
    activityType: "Reactive", trade: prefill?.trade || "", priority: "Medium", location: prefill?.location || "", asset: "",
    tenant: prefill?.tenant || "", reportedBy: prefill?.reportedBy || "", targetDate: addDays(today(), 3), estCost: "", chargeable: false,
  });
  const [assignees, setAssignees] = useState<string[]>([]);
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const manager = !!user && canAssign(user);
  const people = useQuery({ queryKey: ["wo-assignees", f.property], queryFn: () => api.get<WoUserRef[]>(`/work-orders/assignees?property=${encodeURIComponent(f.property)}`), enabled: manager && !!f.property });
  useEffect(() => setAssignees([]), [f.property]);
  const create = useMutation({
    mutationFn: () => api.post<WorkOrderDTO>("/work-orders", { ...f, reportedBy: f.reportedBy || undefined, estCost: f.estCost === "" ? null : Number(f.estCost), assigneeIds: assignees, concernId: prefill?.concernId }),
    onSuccess: (w) => { refresh(w); onCreated?.(w); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Sheet title="New work order" onClose={onClose}>
      <div className="ff"><span className="mu">Building</span>
        <select value={f.property} onChange={(e) => set("property", e.target.value)} disabled={!!prefill?.concernId}>{buildings.map((b) => <option key={b}>{b}</option>)}</select>
      </div>
      <div className="ff"><span className="mu">Title *</span><input value={f.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Lift 2 door closes slowly" /></div>
      <div className="ff"><span className="mu">Description</span><textarea className="in" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
      <div className="fgrid">
        <div className="ff"><span className="mu">Priority</span><select value={f.priority} onChange={(e) => set("priority", e.target.value)}>{WO_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="ff"><span className="mu">Target date *</span><input type="date" value={f.targetDate} onChange={(e) => set("targetDate", e.target.value)} /></div>
        <div className="ff"><span className="mu">Trade</span><select value={f.trade} onChange={(e) => set("trade", e.target.value)}><option value="">–</option>{TRADES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="ff"><span className="mu">Activity type</span><select value={f.activityType} onChange={(e) => set("activityType", e.target.value)}>{ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="ff"><span className="mu">Asset</span><input value={f.asset} onChange={(e) => set("asset", e.target.value)} placeholder="e.g. Lift 2" /></div>
        <div className="ff"><span className="mu">Location</span><input value={f.location} onChange={(e) => set("location", e.target.value)} /></div>
        <div className="ff"><span className="mu">Tenant / company</span><input value={f.tenant} onChange={(e) => set("tenant", e.target.value)} /></div>
        <div className="ff"><span className="mu">Reported by</span><input value={f.reportedBy} onChange={(e) => set("reportedBy", e.target.value)} placeholder={user?.name} /></div>
        <div className="ff"><span className="mu">Est. cost</span><input type="number" min={0} value={f.estCost} onChange={(e) => set("estCost", e.target.value)} /></div>
        <label className="row" style={{ marginTop: 22 }}><input type="checkbox" checked={f.chargeable} onChange={(e) => set("chargeable", e.target.checked)} /> Chargeable to tenant</label>
      </div>
      {manager && (
        <div className="ff"><span className="mu">Assign to</span>
          <AssigneePicker people={people.data ?? []} value={assignees} onChange={setAssignees} />
        </div>
      )}
      {!manager && <p className="mu">A supervisor will assign this work order.</p>}
      {err && <p className="err">{err}</p>}
      <div className="row"><span className="spacer" /><button className="cta" disabled={create.isPending || f.title.trim().length < 3 || !f.property} onClick={() => create.mutate()}>{create.isPending ? "Saving…" : "Create work order"}</button></div>
    </Sheet>
  );
}

function AssigneePicker({ people, value, onChange }: { people: WoUserRef[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!people.length) return <p className="mu">Nobody can be assigned in this building yet. Give technicians this building in Settings.</p>;
  const groups = [...new Set(people.map((p) => p.role))].sort((a, b) => (a === "Technician" ? -1 : b === "Technician" ? 1 : a.localeCompare(b)));
  return (
    <div>
      {groups.map((g) => (
        <div key={g} className="row" style={{ margin: "2px 0" }}>
          <small className="mu" style={{ minWidth: 110 }}>{g}</small>
          {people.filter((p) => p.role === g).map((p) => (
            <label key={p.id} className="row chk"><input type="checkbox" checked={value.includes(p.id)} onChange={(e) => onChange(e.target.checked ? [...value, p.id] : value.filter((x) => x !== p.id))} />{p.name}</label>
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------- detail ----------------
function StatusActions({ w, onDone }: { w: WorkOrderDTO; onDone: (w: WorkOrderDTO) => void }) {
  const { user } = useAuth();
  const [to, setTo] = useState<WoStatus | null>(null);
  const [note, setNote] = useState("");
  const [err, setErr] = useState("");
  const move = useMutation({
    mutationFn: (s: WoStatus) => api.post<WorkOrderDTO>(`/work-orders/${w.id}/status`, { status: s, note }),
    onSuccess: (x) => { setTo(null); setNote(""); setErr(""); onDone(x); },
    onError: (e) => setErr((e as Error).message),
  });
  if (!user || !canWrite(user)) return null;
  const ids = w.assignees.map((a) => a.id);
  const moves = allowedMoves(user, { status: w.status, assigneeIds: ids }).filter((s) => s !== "Assigned"); // "Assigned" is set by assigning people
  if (!moves.length) {
    return user.role === "Technician" && isOpen(w.status) && !ids.includes(user.id) ? <p className="mu">This work order is not assigned to you. You can still add a comment.</p> : null;
  }
  const primary = (s: WoStatus) => ["In Progress", "Completed", "Closed"].includes(s) && !(s === "In Progress" && (w.status === "Completed" || w.status === "Closed"));
  return (
    <div className="card" style={{ background: "var(--bg)" }}>
      <div className="row">
        {moves.map((s) => (
          <button key={s} className={"cta sm" + (primary(s) ? "" : " sec")} disabled={move.isPending} onClick={() => { setErr(""); if (WO_NEEDS_NOTE[s] || s === "Closed" || s === "In Progress") setTo(s); else move.mutate(s); }}>{MOVE_LABEL[s](w.status)}</button>
        ))}
      </div>
      {to && (
        <div style={{ marginTop: 8 }}>
          <p className="mu" style={{ margin: "0 0 4px" }}>{MOVE_LABEL[to](w.status)}: {WO_STATUS_NOTES[to]}</p>
          <textarea className="in" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={WO_NEEDS_NOTE[to] ? WO_NEEDS_NOTE[to] + " (required)" : "Note (optional)"} autoFocus />
          <div className="row">
            <button className="lnk" onClick={() => { setTo(null); setNote(""); }}>Back</button>
            <span className="spacer" />
            <button className="cta sm" disabled={move.isPending || (!!WO_NEEDS_NOTE[to] && !note.trim())} onClick={() => move.mutate(to)}>{move.isPending ? "Saving…" : "Confirm"}</button>
          </div>
        </div>
      )}
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function AssigneesEditor({ w, onDone }: { w: WorkOrderDTO; onDone: (w: WorkOrderDTO) => void }) {
  const [edit, setEdit] = useState(false);
  const [val, setVal] = useState(w.assignees.map((a) => a.id));
  const [err, setErr] = useState("");
  const people = useQuery({ queryKey: ["wo-assignees", w.property], queryFn: () => api.get<WoUserRef[]>(`/work-orders/assignees?property=${encodeURIComponent(w.property)}`), enabled: edit });
  const save = useMutation({
    mutationFn: () => api.put<WorkOrderDTO>(`/work-orders/${w.id}/assignees`, { userIds: val }),
    onSuccess: (x) => { setEdit(false); setErr(""); onDone(x); },
    onError: (e) => setErr((e as Error).message),
  });
  if (!edit) return <button className="lnk" onClick={() => { setVal(w.assignees.map((a) => a.id)); setEdit(true); }}>{w.assignees.length ? "Change" : "Assign"}</button>;
  return (
    <div style={{ marginTop: 6 }}>
      {people.isLoading ? <p className="mu">Loading…</p> : <AssigneePicker people={people.data ?? []} value={val} onChange={setVal} />}
      <div className="row"><button className="lnk" onClick={() => setEdit(false)}>Cancel</button><span className="spacer" /><button className="cta sm" disabled={save.isPending} onClick={() => save.mutate()}>Save assignees</button></div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

type NoteKey = "actionTaken" | "rootCause" | "remarks" | "reason";
const NOTE_FIELDS: [NoteKey, string][] = [["actionTaken", "Action taken"], ["rootCause", "Root cause"], ["reason", "Reason for delay"], ["remarks", "Remarks"]];

function WorkNotes({ w, onDone }: { w: WorkOrderDTO; onDone: (w: WorkOrderDTO) => void }) {
  const { user } = useAuth();
  const editable = !!user && canWrite(user) && canEditWorkNotes(user, { assigneeIds: w.assignees.map((a) => a.id) });
  const init = () => Object.fromEntries(NOTE_FIELDS.map(([k]) => [k, w[k]])) as Record<NoteKey, string>;
  const [f, setF] = useState(init);
  const [err, setErr] = useState("");
  useEffect(() => setF(init()), [w.updatedAt]); // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = NOTE_FIELDS.some(([k]) => f[k] !== w[k]);
  const save = useMutation({
    mutationFn: () => api.patch<WorkOrderDTO>(`/work-orders/${w.id}`, Object.fromEntries(NOTE_FIELDS.filter(([k]) => f[k] !== w[k]).map(([k]) => [k, f[k]]))),
    onSuccess: (x) => { setErr(""); onDone(x); },
    onError: (e) => setErr((e as Error).message),
  });
  if (!editable) {
    return <dl className="kv">{NOTE_FIELDS.map(([k, l]) => <Fragment key={k}><dt>{l}</dt><dd>{w[k] || "–"}</dd></Fragment>)}</dl>;
  }
  return (
    <>
      {NOTE_FIELDS.map(([k, l]) => (
        <div className="ff" key={k}><span className="mu">{l}</span><textarea className="in" rows={k === "actionTaken" ? 3 : 2} value={f[k]} onChange={(e) => setF((x) => ({ ...x, [k]: e.target.value }))} /></div>
      ))}
      <div className="row"><span className="spacer" />{dirty && <button className="lnk" onClick={() => setF(init())}>Undo</button>}<button className="cta sm" disabled={!dirty || save.isPending} onClick={() => save.mutate()}>Save notes</button></div>
      {err && <p className="err">{err}</p>}
    </>
  );
}

function DetailsEditor({ w, onDone, onCancel }: { w: WorkOrderDTO; onDone: (w: WorkOrderDTO) => void; onCancel: () => void }) {
  const [f, setF] = useState({ title: w.title, description: w.description, priority: w.priority, targetDate: w.targetDate, trade: w.trade, activityType: w.activityType, asset: w.asset, location: w.location, tenant: w.tenant, reportedBy: w.reportedBy, estCost: w.estCost == null ? "" : String(w.estCost), chargeable: w.chargeable });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => api.patch<WorkOrderDTO>(`/work-orders/${w.id}`, { ...f, estCost: f.estCost === "" ? null : Number(f.estCost) }),
    onSuccess: (x) => onDone(x),
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <div className="card" style={{ background: "var(--bg)" }}>
      <div className="ff"><span className="mu">Title</span><input value={f.title} onChange={(e) => set("title", e.target.value)} /></div>
      <div className="ff"><span className="mu">Description</span><textarea className="in" rows={3} value={f.description} onChange={(e) => set("description", e.target.value)} /></div>
      <div className="fgrid">
        <div className="ff"><span className="mu">Priority</span><select value={f.priority} onChange={(e) => set("priority", e.target.value)}>{WO_PRIORITIES.map((p) => <option key={p}>{p}</option>)}</select></div>
        <div className="ff"><span className="mu">Target date</span><input type="date" value={f.targetDate} onChange={(e) => set("targetDate", e.target.value)} /></div>
        <div className="ff"><span className="mu">Trade</span><select value={f.trade} onChange={(e) => set("trade", e.target.value)}><option value="">–</option>{TRADES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="ff"><span className="mu">Activity type</span><select value={f.activityType} onChange={(e) => set("activityType", e.target.value)}>{ACTIVITY_TYPES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="ff"><span className="mu">Asset</span><input value={f.asset} onChange={(e) => set("asset", e.target.value)} /></div>
        <div className="ff"><span className="mu">Location</span><input value={f.location} onChange={(e) => set("location", e.target.value)} /></div>
        <div className="ff"><span className="mu">Tenant / company</span><input value={f.tenant} onChange={(e) => set("tenant", e.target.value)} /></div>
        <div className="ff"><span className="mu">Reported by</span><input value={f.reportedBy} onChange={(e) => set("reportedBy", e.target.value)} /></div>
        <div className="ff"><span className="mu">Est. cost</span><input type="number" min={0} value={f.estCost} onChange={(e) => set("estCost", e.target.value)} /></div>
        <label className="row" style={{ marginTop: 22 }}><input type="checkbox" checked={f.chargeable} onChange={(e) => set("chargeable", e.target.checked)} /> Chargeable to tenant</label>
      </div>
      <div className="row"><button className="lnk" onClick={onCancel}>Cancel</button><span className="spacer" /><button className="cta sm" disabled={save.isPending || f.title.trim().length < 3} onClick={() => save.mutate()}>Save details</button></div>
      {err && <p className="err">{err}</p>}
    </div>
  );
}

function History({ w, onDone }: { w: WorkOrderDTO; onDone: (w: WorkOrderDTO) => void }) {
  const { user } = useAuth();
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const add = useMutation({
    mutationFn: () => api.post<WorkOrderDTO>(`/work-orders/${w.id}/comments`, { message: msg }),
    onSuccess: (x) => { setMsg(""); setErr(""); onDone(x); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <>
      {(w.events ?? []).map((e) =>
        e.kind === "comment" ? (
          <div key={e.id} className="msg staff"><small>{e.authorName} · {when(e.createdAt)}</small><div style={{ whiteSpace: "pre-wrap" }}>{e.message}</div></div>
        ) : (
          <p key={e.id} className="mu" style={{ margin: "4px 0" }}>
            · {e.kind === "created" ? "Created" : e.kind === "status" ? <>Status {e.fromStatus ? <>{e.fromStatus} → </> : null}<b>{e.toStatus}</b></> : e.message}
            {e.kind === "status" && e.message ? <>: “{e.message}”</> : e.kind === "created" && e.message ? <> · {e.message}</> : null}
            {" "}· {e.authorName} · {when(e.createdAt)}
          </p>
        ),
      )}
      {canWrite(user) && (
        <>
          <textarea className="in" rows={2} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Add a comment or progress update" />
          <div className="row"><span className="spacer" /><button className="cta sm" disabled={!msg.trim() || add.isPending} onClick={() => add.mutate()}>Add comment</button></div>
          {err && <p className="err">{err}</p>}
        </>
      )}
    </>
  );
}

export function WorkOrderSheet({ id, onClose }: { id: string; onClose: () => void }) {
  const { user } = useAuth();
  const q = useWorkOrder(id);
  const refresh = useRefresh();
  const [editing, setEditing] = useState(false);
  const w = q.data;
  return (
    <Sheet title={w ? `${w.ticket} · ${w.property}` : "Work order"} onClose={onClose}>
      {q.isLoading && <p className="mu">Loading…</p>}
      {q.error && <p className="err">{(q.error as Error).message}</p>}
      {w && (
        <>
          <div className="row" style={{ marginBottom: 6 }}>
            <StatusPill s={w.status} /> <PrioPill p={w.priority} />
            <b style={{ fontSize: 16 }}>{w.title}</b>
            <span className="spacer" />
            {user && canWrite(user) && canEditDetails(user) && !editing && <button className="lnk" onClick={() => setEditing(true)}>Edit details</button>}
          </div>
          {w.status === "On Hold" && w.holdReason && <p className="err">On hold: {w.holdReason}</p>}
          <StatusActions w={w} onDone={refresh} />
          {editing ? <DetailsEditor w={w} onCancel={() => setEditing(false)} onDone={(x) => { setEditing(false); refresh(x); }} /> : (
            <dl className="kv">
              <dt>Assigned to</dt>
              <dd>
                {w.assignees.length ? w.assignees.map((a) => a.name).join(", ") : <span className="err">Nobody yet</span>}
                {w.ownerName && <span className="mu"> (old log owner: {w.ownerName})</span>}
                {user && canWrite(user) && canAssign(user) && isOpen(w.status) && <> · <AssigneesEditor w={w} onDone={refresh} /></>}
              </dd>
              {w.description && w.description !== w.title && <><dt>Description</dt><dd>{w.description}</dd></>}
              <dt>Opened</dt><dd>{fmtDate(w.dateOpened)}{w.reportedBy ? ` · reported by ${w.reportedBy}` : ""}</dd>
              <dt>Target</dt><dd>{fmtDate(w.targetDate)}{isOpen(w.status) && w.targetDate < today() ? <span className="pill r" style={{ marginLeft: 6 }}>Past target</span> : null}</dd>
              {w.startedAt && <><dt>Started</dt><dd>{when(w.startedAt)}</dd></>}
              {w.completedAt && <><dt>Completed</dt><dd>{when(w.completedAt)}</dd></>}
              {w.closedAt && <><dt>Closed</dt><dd>{when(w.closedAt)}</dd></>}
              <dt>Type</dt><dd>{w.activityType}{w.trade ? " · " + w.trade : ""}</dd>
              {(w.asset || w.location) && <><dt>Asset / location</dt><dd>{[w.asset, w.location].filter(Boolean).join(" · ")}</dd></>}
              {w.tenant && <><dt>Tenant</dt><dd>{w.tenant}{w.chargeable ? " · chargeable" : ""}</dd></>}
              {w.estCost != null && <><dt>Est. cost</dt><dd>{w.estCost.toLocaleString("en-US")}</dd></>}
            </dl>
          )}
          <h3>Work notes</h3>
          <WorkNotes w={w} onDone={refresh} />
          <h3>History</h3>
          <History w={w} onDone={refresh} />
        </>
      )}
    </Sheet>
  );
}

// ---------------- list ----------------
export default function WorkOrders() {
  const { user } = useAuth();
  const { building } = useFilter();
  const [filter, setFilter] = useState<string>(() => sessionStorage.getItem("pmd.woFilter") || (user?.role === "Technician" ? "mine" : "open"));
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const scope = useQuery({ queryKey: ["concern-buildings"], queryFn: () => api.get<string[]>("/concerns/buildings") });
  const params = new URLSearchParams();
  if (building !== "All") params.set("property", building);
  if (filter === "mine") { params.set("mine", "1"); params.set("status", "open"); } else params.set("status", filter);
  const q = useQuery({ queryKey: ["wos", params.toString()], queryFn: () => api.get<WorkOrderDTO[]>(`/work-orders?${params}`), refetchInterval: 60_000 });
  const pick = (k: string) => { sessionStorage.setItem("pmd.woFilter", k); setFilter(k); };
  const list = useMemo(() => {
    const s = search.trim().toLowerCase();
    const L = (q.data ?? []).filter((w) => !s || [w.ticket, w.title, w.asset, w.location, w.tenant, w.property, ...w.assignees.map((a) => a.name)].some((x) => x.toLowerCase().includes(s)));
    const rank: Record<string, number> = { Urgent: 0, High: 1, Medium: 2, Low: 3 };
    return L.sort((a, b) => (isOpen(a.status) && isOpen(b.status) ? rank[a.priority] - rank[b.priority] : 0) || a.targetDate.localeCompare(b.targetDate));
  }, [q.data, search]);
  const t = today();
  const buildings = scope.data ?? [];

  return (
    <>
      <Card
        title="Work orders"
        sub={user?.role === "Technician" ? "Work orders in your buildings. Start, pause and complete the ones assigned to you; a supervisor verifies and closes them." : "Every work order with its status and who is working on it. Supervisors assign, verify and close; technicians start, pause and complete their own."}
        right={canWrite(user) && buildings.length ? <button className="cta sm" onClick={() => setCreating(true)}>+ New work order</button> : null}
      >
        <div className="tabs">{FILTERS.map(([k, l]) => <button key={k} className={filter === k ? "on" : ""} onClick={() => pick(k)}>{l}</button>)}</div>
        <input className="in" style={{ width: "100%" }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ticket, title, asset, tenant or person" />
      </Card>
      {q.error ? <ErrorBox error={q.error} /> : (
        <div className="card">
          {q.isLoading ? <p className="mu">Loading…</p> : !list.length ? <p className="mu">No work orders here.</p> : (
            <>
            <div className="wocards">
              {list.map((w) => (
                <div key={w.id} className="woc" onClick={() => setSel(w.id)}>
                  <div className="row"><StatusPill s={w.status} /><PrioPill p={w.priority} /><span className="spacer" /><small className="mu">{w.ticket}</small></div>
                  <b>{w.title}</b>
                  <small className="mu">{w.property}{w.asset ? " · " + w.asset : ""} · target {isOpen(w.status) && w.targetDate < t ? <span className="err">{fmtDate(w.targetDate)}</span> : fmtDate(w.targetDate)}</small>
                  <small className="mu">{w.assignees.length ? w.assignees.map((a) => a.name).join(", ") : "Not assigned"}</small>
                </div>
              ))}
            </div>
            <div className="wotable">
            <Table head={["Ticket", "Building", "Title", "Priority", "Status", "Assigned to", "Target", "Opened"]}>
              {list.map((w) => (
                <tr key={w.id} className="click" onClick={() => setSel(w.id)}>
                  <td>{w.ticket}</td><td>{w.property}</td><td className="wrap">{w.title}</td><td><PrioPill p={w.priority} /></td>
                  <td><StatusPill s={w.status} /></td>
                  <td className="wrap">{w.assignees.length ? w.assignees.map((a) => a.name).join(", ") : <span className="mu">–</span>}</td>
                  <td>{isOpen(w.status) && w.targetDate < t ? <span className="pill r">{fmtDate(w.targetDate)}</span> : fmtDate(w.targetDate)}</td>
                  <td>{fmtDate(w.dateOpened)}</td>
                </tr>
              ))}
            </Table>
            </div>
            </>
          )}
          {!!list.length && <p className="mu">{list.length} work order{list.length === 1 ? "" : "s"}{list.length >= 2000 ? " (first 2,000; narrow the filter)" : ""}.</p>}
        </div>
      )}
      {sel && <WorkOrderSheet id={sel} onClose={() => setSel(null)} />}
      {creating && <NewWorkOrderSheet buildings={buildings} prefill={building !== "All" ? { property: building } : undefined} onClose={() => setCreating(false)} onCreated={(w) => setSel(w.id)} />}
    </>
  );
}
