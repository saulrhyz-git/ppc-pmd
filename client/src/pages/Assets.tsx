// Buildings, units/spaces and equipment as linked records, with their work orders.
// These catalogs are shown on the Configuration screen.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ASSET_CATEGORIES, ASSET_STATUSES, BUILDING_KINDS, TRADES, UNIT_KINDS, UNIT_OCCUPANCY, UNIT_STATUSES, isMeterManager,
  type AssetDTO, type BuildingChangeDTO, type BuildingDTO, type UnitDTO,
} from "@pmd/shared";
import { api } from "../api";
import { useAuth } from "../auth";
import { useFilter, useMeta } from "../state";
import { ErrorBox, Sheet, Table } from "../ui";
import { fmtDate } from "./common";
import { NewWorkOrderSheet, StatusPill, useAssetLookup, WorkOrderSheet, type WoPrefill } from "./WorkOrders";

type WoLite = { id: string; ticket: string; title: string; status: string; dateOpened: string | null; priority: string };
type UnitDetail = UnitDTO & { assets: { id: string; tag: string; name: string; category: string; status: string }[]; meters: { id: string; code: string; meterClass: string; utility: string; unitOfMeasure: string }[]; workOrders: WoLite[] };
type AssetDetail = AssetDTO & { children: { id: string; tag: string; name: string; status: string }[]; meters: { id: string; code: string; meterClass: string }[]; workOrders: (WoLite & { completedAt: string | null })[] };

export function useCanEdit() {
  const { user } = useAuth();
  // The Department Head always manages these records, whatever their screen access is set to.
  return !!user && (user.role === "Department Head" || ((user.tabs.ast ?? 0) >= 2 && isMeterManager(user.role)));
}
function useRefresh() {
  const qc = useQueryClient();
  return () => {
    for (const k of ["buildings", "units", "unit", "assets", "asset", "asset-lookup"]) qc.invalidateQueries({ queryKey: [k] });
  };
}
export const useBuildings = () => useQuery({ queryKey: ["buildings"], queryFn: () => api.get<BuildingDTO[]>("/assets/buildings") });
/** Every building in scope including archived ones (Configuration only). */
const useAllBuildings = () => useQuery({ queryKey: ["buildings", "with-archived"], queryFn: () => api.get<BuildingDTO[]>("/assets/buildings?archived=1") });

/** Building picker that follows the header filter but needs a single building for adding records. */
function BuildingSelect({ buildings, value, onChange }: { buildings: BuildingDTO[]; value: string; onChange: (id: string) => void }) {
  return (
    <select className="in" value={value} onChange={(e) => onChange(e.target.value)}>
      {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
    </select>
  );
}

// ---------------- buildings ----------------
export function Buildings() {
  const q = useAllBuildings();
  const meta = useMeta();
  const { user } = useAuth();
  const canEdit = useCanEdit();
  const isDH = user?.role === "Department Head";
  const [edit, setEdit] = useState<BuildingDTO | "new" | null>(null);
  const [search, setSearch] = useState("");
  const [show, setShow] = useState<"active" | "archived" | "all">("active");
  const archivedCount = (q.data ?? []).filter((b) => b.archivedAt).length;
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((b) => (show === "all" || (show === "archived") === !!b.archivedAt)
      && (!s || [b.name, b.code, b.address, b.kind, b.section ?? ""].some((x) => x.toLowerCase().includes(s))));
  }, [q.data, search, show]);
  if (q.error) return <ErrorBox error={q.error} />;
  const open = (b: BuildingDTO) => (canEdit || b.archivedAt ? setEdit(b) : undefined);
  return (
    <div className="card">
      <div className="row">
        <h2 style={{ margin: 0 }}>Buildings</h2>
        <input className="in" style={{ flex: 1, minWidth: 180 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, code, address or section" />
        <div className="tabs" style={{ margin: 0 }}>
          <button className={show === "active" ? "on" : ""} onClick={() => setShow("active")}>In use</button>
          <button className={show === "archived" ? "on" : ""} onClick={() => setShow("archived")}>Archived ({archivedCount})</button>
          <button className={show === "all" ? "on" : ""} onClick={() => setShow("all")}>All</button>
        </div>
        {isDH && <button className="cta sm" onClick={() => setEdit("new")}>+ Building</button>}
      </div>
      <p className="mu">{isDH ? "Add a building here, or open one to edit, rename or archive it. A rename or archive needs a reason and is kept in the building's history. " : "The Department Head adds, renames and archives buildings. "}Archived buildings keep all their records but drop out of dashboards, pickers and imports.</p>
      {q.isLoading ? <p className="mu">Loading…</p> : !rows.length ? <p className="mu">{q.data?.length ? (show === "archived" ? "No archived buildings." : "No building matches.") : "No buildings yet."}</p> : (
        <Table head={["Building", "Code", "Kind", "Section", "Floors", "Address", "Units", "Equipment", "Meters", ""]}>
          {rows.map((b) => (
            <tr key={b.id} className="click" onClick={() => open(b)} style={b.archivedAt ? { opacity: 0.6 } : undefined}>
              <td><b>{b.name}</b>{b.archivedAt && <span className="pill" style={{ marginLeft: 6, background: "var(--mu)" }}>Archived</span>}</td>
              <td>{b.code || "–"}</td><td>{b.kind}</td><td>{b.section ?? <span className="mu">Unassigned</span>}</td><td>{b.floors ?? "–"}</td>
              <td className="wrap">{b.address || "–"}</td><td>{b.unitCount}</td><td>{b.assetCount}</td><td>{b.meterCount}</td>
              <td>{b.archivedAt ? <button className="lnk">View</button> : canEdit && <button className="lnk">Edit</button>}</td>
            </tr>
          ))}
        </Table>
      )}
      {!!rows.length && <p className="mu">{rows.length} building{rows.length === 1 ? "" : "s"}.</p>}
      {edit && <BuildingEditor b={edit === "new" ? null : edit} sections={meta.data?.sections ?? []} isDH={isDH} onClose={() => setEdit(null)} />}
    </div>
  );
}

/** Refreshes everything that lists buildings: header filter, dashboards and every building picker. */
function useBuildingRefresh() {
  const refresh = useRefresh();
  const qc = useQueryClient();
  return () => {
    refresh();
    for (const k of ["meta", "dashboard", "concern-buildings", "meter-board", "rows", "wos", "users"]) qc.invalidateQueries({ queryKey: [k] });
  };
}

function BuildingEditor({ b, sections, isDH, onClose }: { b: BuildingDTO | null; sections: string[]; isDH: boolean; onClose: () => void }) {
  const refresh = useBuildingRefresh();
  const [f, setF] = useState({
    name: b?.name ?? "", section: b?.section ?? "", kind: b?.kind ?? "Commercial", code: b?.code ?? "", address: b?.address ?? "",
    floors: b?.floors == null ? "" : String(b.floors), notes: b?.notes ?? "",
  });
  const [err, setErr] = useState("");
  const [action, setAction] = useState<"rename" | "archive" | "restore" | null>(null);
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const archived = !!b?.archivedAt;
  const save = useMutation({
    mutationFn: () => {
      const { name, section, ...rest } = f;
      const body = { ...rest, floors: f.floors === "" ? null : Number(f.floors), ...(isDH ? { section: section || null } : {}) };
      return b ? api.patch(`/assets/buildings/${b.id}`, body) : api.post("/assets/buildings", { ...body, name });
    },
    onSuccess: () => { refresh(); onClose(); },
    onError: (e) => setErr((e as Error).message),
  });
  if (b && action) return <BuildingAction b={b} action={action} onBack={() => setAction(null)} onDone={() => { refresh(); onClose(); }} />;
  return (
    <Sheet title={b ? (archived ? `${b.name} (archived)` : `Edit ${b.name}`) : "New building"} onClose={onClose}>
      {archived && (
        <div className="er bad" style={{ cursor: "default" }}>
          <b>Archived {fmtDate(b!.archivedAt!.slice(0, 10))}{b!.archivedBy ? ` by ${b!.archivedBy}` : ""}</b>
          <span className="mu">Reason: {b!.archiveReason || "–"}</span>
          {isDH && <div className="row" style={{ marginTop: 6 }}><button className="cta sm" onClick={() => setAction("restore")}>Restore building</button></div>}
        </div>
      )}
      <fieldset disabled={archived} style={{ border: 0, padding: 0, margin: 0 }}>
        <div className="fgrid">
          {!b && <div className="ff" style={{ gridColumn: "1 / -1" }}><span className="mu">Building name *</span><input autoFocus value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Annex C" /></div>}
          <div className="ff"><span className="mu">Short code</span><input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="e.g. I3" /></div>
          <div className="ff"><span className="mu">Kind</span><select value={f.kind} onChange={(e) => set("kind", e.target.value)}>{BUILDING_KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
          <div className="ff"><span className="mu">Section</span>
            <select value={f.section} disabled={!isDH} onChange={(e) => set("section", e.target.value)}><option value="">Unassigned</option>{sections.map((s) => <option key={s}>{s}</option>)}</select>
          </div>
          <div className="ff"><span className="mu">Floors</span><input type="number" min={0} value={f.floors} onChange={(e) => set("floors", e.target.value)} /></div>
        </div>
        <div className="ff"><span className="mu">Address</span><input value={f.address} onChange={(e) => set("address", e.target.value)} /></div>
        <div className="ff"><span className="mu">Notes</span><textarea className="in" rows={3} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      </fieldset>
      {!b && <p className="mu">Supervisors see the buildings in their section. Engineers and technicians are given buildings one by one under Settings, Users &amp; access.</p>}
      {err && <p className="err">{err}</p>}
      {!archived && (
        <div className="row">
          {b && isDH && <><button className="lnk" onClick={() => setAction("rename")}>Rename…</button><button className="lnk" style={{ color: "var(--r)" }} onClick={() => setAction("archive")}>Archive…</button></>}
          <span className="spacer" />
          <button className="cta" disabled={save.isPending || (!b && f.name.trim().length < 2)} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : b ? "Save" : "Add building"}</button>
        </div>
      )}
      {b && <BuildingHistory id={b.id} />}
    </Sheet>
  );
}

const ACTION_TEXT = {
  rename: { title: "Rename", button: "Rename building", reasonHint: "e.g. Building renamed by the owner after the sale" },
  archive: { title: "Archive", button: "Archive building", reasonHint: "e.g. Management contract ended on 30 Nov 2026" },
  restore: { title: "Restore", button: "Restore building", reasonHint: "e.g. Contract renewed" },
} as const;

/** Rename, archive or restore. Each needs a reason, which is kept in the building's history. */
function BuildingAction({ b, action, onBack, onDone }: { b: BuildingDTO; action: "rename" | "archive" | "restore"; onBack: () => void; onDone: () => void }) {
  const [name, setName] = useState(b.name);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState("");
  const t = ACTION_TEXT[action];
  const go = useMutation({
    mutationFn: () => api.post(`/assets/buildings/${b.id}/${action}`, action === "rename" ? { name, reason } : { reason }),
    onSuccess: onDone,
    onError: (e) => setErr((e as Error).message),
  });
  const ok = reason.trim().length >= 5 && (action !== "rename" || (name.trim().length >= 2 && name.trim() !== b.name));
  return (
    <Sheet title={`${t.title} ${b.name}`} onClose={onBack}>
      {action === "rename" && (
        <>
          <div className="ff"><span className="mu">New name *</span><input autoFocus value={name} onChange={(e) => setName(e.target.value)} /></div>
          <p className="mu">The new name replaces the old one everywhere: dashboards, registers, concerns, work orders and each user's building list.</p>
        </>
      )}
      {action === "archive" && (
        <p className="mu">{b.name} will drop out of dashboards, the building filter, pickers and imports. Its {b.unitCount} units, {b.assetCount} pieces of equipment, {b.meterCount} meters and all past records are kept, and you can restore it at any time.</p>
      )}
      {action === "restore" && <p className="mu">{b.name} comes back into dashboards, pickers and each user's scope.</p>}
      <div className="ff"><span className="mu">Reason *</span><textarea className="in" rows={3} autoFocus={action !== "rename"} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t.reasonHint} /></div>
      {err && <p className="err">{err}</p>}
      <div className="row">
        <button className="lnk" onClick={onBack}>Back</button><span className="spacer" />
        <button className="cta" style={action === "archive" ? { background: "var(--r)" } : undefined} disabled={!ok || go.isPending} onClick={() => go.mutate()}>{go.isPending ? "Saving…" : t.button}</button>
      </div>
    </Sheet>
  );
}

function BuildingHistory({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["buildings", "history", id], queryFn: () => api.get<BuildingChangeDTO[]>(`/assets/buildings/${id}/history`) });
  if (!q.data?.length) return null;
  return (
    <>
      <h3>Rename and archive history</h3>
      {q.data.map((c) => (
        <div key={c.id} className="msg staff">
          <b>{c.kind === "Renamed" ? `Renamed from ${c.fromName} to ${c.toName}` : c.kind}</b> <small>{new Date(c.at).toLocaleString("en-GB")} · {c.byName}</small>
          <div>{c.reason}</div>
        </div>
      ))}
    </>
  );
}

// ---------------- units ----------------
function useBuildingChoice() {
  const { building } = useFilter();
  const b = useBuildings();
  const list = b.data ?? [];
  const current = building === "All" ? null : list.find((x) => x.name === building) ?? null;
  return { list, current, building };
}

export function Units({ onOpen }: { onOpen: (id: string) => void }) {
  const { list, building } = useBuildingChoice();
  const canEdit = useCanEdit();
  const [search, setSearch] = useState("");
  const [adding, setAdding] = useState<"one" | "many" | null>(null);
  const qs = building === "All" ? "" : `?property=${encodeURIComponent(building)}`;
  const q = useQuery({ queryKey: ["units", qs], queryFn: () => api.get<UnitDTO[]>(`/assets/units${qs}`) });
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((u) => !s || [u.code, u.floor, u.kind, u.ownerName, u.tenantName, u.property, u.occupancy].some((x) => x.toLowerCase().includes(s)));
  }, [q.data, search]);
  if (q.error) return <ErrorBox error={q.error} />;
  const many = building === "All" && list.length > 1;
  return (
    <div className="card">
      <div className="row">
        <input className="in" style={{ flex: 1 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search unit, floor, owner or tenant" />
        {canEdit && list.length > 0 && <><button className="cta sm" onClick={() => setAdding("one")}>+ Unit</button><button className="cta sm sec" onClick={() => setAdding("many")}>Add many</button></>}
      </div>
      {q.isLoading ? <p className="mu">Loading…</p> : !rows.length ? <p className="mu">{q.data?.length ? "No unit matches." : "No units or spaces recorded yet. Add them one by one, or paste a list with Add many."}</p> : (
        <Table head={[...(many ? ["Building"] : []), "Unit", "Floor", "Kind", "Occupancy", "Owner", "Tenant", "Meters", "Open WOs"]}>
          {rows.map((u) => (
            <tr key={u.id} className="click" onClick={() => onOpen(u.id)} style={u.status === "Inactive" ? { opacity: 0.55 } : undefined}>
              {many && <td>{u.property}</td>}
              <td><b>{u.code}</b></td><td>{u.floor || "–"}</td><td>{u.kind}</td><td>{u.occupancy}</td>
              <td className="wrap">{u.ownerName || "–"}</td><td className="wrap">{u.tenantName || "–"}</td><td>{u.meterCount || "–"}</td>
              <td>{u.openWorkOrders ? <span className="pill a">{u.openWorkOrders}</span> : "–"}</td>
            </tr>
          ))}
        </Table>
      )}
      {!!rows.length && <p className="mu">{rows.length} unit{rows.length === 1 ? "" : "s"}.</p>}
      {adding === "one" && <UnitEditor onClose={() => setAdding(null)} onSaved={onOpen} />}
      {adding === "many" && <UnitImport onClose={() => setAdding(null)} />}
    </div>
  );
}

const emptyUnit = { code: "", kind: "Commercial space", floor: "", areaSqm: "", occupancy: "Vacant", ownerName: "", tenantName: "", status: "Active", notes: "" };

function UnitEditor({ unit, onClose, onSaved }: { unit?: UnitDTO; onClose: () => void; onSaved?: (id: string) => void }) {
  const { list, current } = useBuildingChoice();
  const refresh = useRefresh();
  const [propertyId, setPropertyId] = useState(unit?.propertyId ?? current?.id ?? list[0]?.id ?? "");
  const bKind = list.find((b) => b.id === propertyId)?.kind;
  const [f, setF] = useState(() => unit
    ? { code: unit.code, kind: unit.kind as string, floor: unit.floor, areaSqm: unit.areaSqm == null ? "" : String(unit.areaSqm), occupancy: unit.occupancy as string, ownerName: unit.ownerName, tenantName: unit.tenantName, status: unit.status, notes: unit.notes }
    : { ...emptyUnit, kind: bKind === "Condominium" ? "Condominium unit" : "Commercial space" });
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, areaSqm: f.areaSqm === "" ? null : Number(f.areaSqm) };
      return unit ? api.patch<UnitDTO>(`/assets/units/${unit.id}`, body) : api.post<UnitDTO>("/assets/units", { ...body, propertyId });
    },
    onSuccess: (u) => { refresh(); onClose(); onSaved?.(u.id); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Sheet title={unit ? `Edit unit ${unit.code}` : "New unit or space"} onClose={onClose}>
      {!unit && list.length > 1 && <div className="ff"><span className="mu">Building</span><BuildingSelect buildings={list} value={propertyId} onChange={setPropertyId} /></div>}
      <div className="fgrid">
        <div className="ff"><span className="mu">Unit code *</span><input value={f.code} onChange={(e) => set("code", e.target.value)} placeholder="e.g. 12-03 or GF-05" /></div>
        <div className="ff"><span className="mu">Floor</span><input value={f.floor} onChange={(e) => set("floor", e.target.value)} /></div>
        <div className="ff"><span className="mu">Kind</span><select value={f.kind} onChange={(e) => set("kind", e.target.value)}>{UNIT_KINDS.map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="ff"><span className="mu">Area (m²)</span><input type="number" min={0} value={f.areaSqm} onChange={(e) => set("areaSqm", e.target.value)} /></div>
        <div className="ff"><span className="mu">Occupancy</span><select value={f.occupancy} onChange={(e) => set("occupancy", e.target.value)}>{UNIT_OCCUPANCY.map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="ff"><span className="mu">Status</span><select value={f.status} onChange={(e) => set("status", e.target.value)}>{UNIT_STATUSES.map((k) => <option key={k}>{k}</option>)}</select></div>
        <div className="ff"><span className="mu">Owner</span><input value={f.ownerName} onChange={(e) => set("ownerName", e.target.value)} /></div>
        <div className="ff"><span className="mu">Tenant / company</span><input value={f.tenantName} onChange={(e) => set("tenantName", e.target.value)} /></div>
      </div>
      <div className="ff"><span className="mu">Notes</span><textarea className="in" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      {err && <p className="err">{err}</p>}
      <div className="row"><span className="spacer" /><button className="cta" disabled={save.isPending || !f.code.trim() || !propertyId} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</button></div>
    </Sheet>
  );
}

/** Paste rows from a spreadsheet: code, floor, kind, occupancy, owner, tenant, area. */
function UnitImport({ onClose }: { onClose: () => void }) {
  const { list, current } = useBuildingChoice();
  const refresh = useRefresh();
  const [propertyId, setPropertyId] = useState(current?.id ?? list[0]?.id ?? "");
  const [text, setText] = useState("");
  const [msg, setMsg] = useState(""), [err, setErr] = useState("");
  const bKind = list.find((b) => b.id === propertyId)?.kind;
  const parsed = useMemo(() => {
    const kinds = new Map(UNIT_KINDS.map((k) => [k.toLowerCase(), k]));
    const occ = new Map(UNIT_OCCUPANCY.map((k) => [k.toLowerCase(), k]));
    const rows: Record<string, unknown>[] = [];
    const bad: string[] = [];
    text.split(/\r?\n/).forEach((line, i) => {
      if (!line.trim()) return;
      const c = line.split(line.includes("\t") ? "\t" : ",").map((x) => x.trim());
      if (i === 0 && /^unit|^code/i.test(c[0])) return; // header row
      const kind = kinds.get((c[2] || "").toLowerCase()) ?? (bKind === "Condominium" ? "Condominium unit" : "Commercial space");
      const area = c[6] ? Number(c[6].replace(/,/g, "")) : null;
      if (!c[0] || (area != null && !isFinite(area))) { bad.push(`Line ${i + 1}`); return; }
      rows.push({ code: c[0], floor: c[1] || "", kind, occupancy: occ.get((c[3] || "").toLowerCase()) ?? (c[5] ? "Leased" : c[4] ? "Owner-occupied" : "Vacant"), ownerName: c[4] || "", tenantName: c[5] || "", areaSqm: area });
    });
    return { rows, bad };
  }, [text, bKind]);
  const save = useMutation({
    mutationFn: () => api.post<{ created: number; updated: number }>("/assets/units/import", { propertyId, rows: parsed.rows }),
    onSuccess: (r) => { refresh(); setMsg(`Added ${r.created} and updated ${r.updated} unit${r.created + r.updated === 1 ? "" : "s"}.`); setText(""); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Sheet title="Add many units" onClose={onClose}>
      {list.length > 1 && <div className="ff"><span className="mu">Building</span><BuildingSelect buildings={list} value={propertyId} onChange={setPropertyId} /></div>}
      <p className="mu">Paste from a spreadsheet, one unit per line, in this column order: <b>unit code, floor, kind, occupancy, owner, tenant, area m²</b>. Only the code is required. Units that already exist (same code) are updated.</p>
      <textarea rows={10} value={text} onChange={(e) => { setText(e.target.value); setMsg(""); setErr(""); }} placeholder={"12-01, 12, Condominium unit, Owner-occupied, J. Santos, , 54.5\n12-02, 12, Condominium unit, Leased, A. Reyes, B. Cruz, 48"} />
      <p className="mu">{parsed.rows.length} unit{parsed.rows.length === 1 ? "" : "s"} ready{parsed.bad.length ? ` · skipped: ${parsed.bad.join(", ")}` : ""}.</p>
      {msg && <p className="okmsg">{msg}</p>}
      {err && <p className="err">{err}</p>}
      <div className="row"><span className="spacer" /><button className="cta" disabled={save.isPending || !parsed.rows.length || !propertyId} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save units"}</button></div>
    </Sheet>
  );
}

export function UnitSheet({ id, onClose, onOpenAsset }: { id: string; onClose: () => void; onOpenAsset: (id: string) => void }) {
  const q = useQuery({ queryKey: ["unit", id], queryFn: () => api.get<UnitDetail>(`/assets/units/${id}`) });
  const canEdit = useCanEdit();
  const { user } = useAuth();
  const refresh = useRefresh();
  const [editing, setEditing] = useState(false);
  const [wo, setWo] = useState<WoPrefill | null>(null);
  const [openWo, setOpenWo] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const del = useMutation({ mutationFn: () => api.del(`/assets/units/${id}`), onSuccess: () => { refresh(); onClose(); }, onError: (e) => setErr((e as Error).message) });
  const u = q.data;
  if (editing && u) return <UnitEditor unit={u} onClose={() => { setEditing(false); q.refetch(); }} />;
  if (wo) return <NewWorkOrderSheet buildings={[u!.property]} prefill={wo} onClose={() => setWo(null)} onCreated={(w) => { setWo(null); setOpenWo(w.id); q.refetch(); }} />;
  if (openWo) return <WorkOrderSheet id={openWo} onClose={() => { setOpenWo(null); q.refetch(); }} />;
  return (
    <Sheet title={u ? `Unit ${u.code}` : "Unit"} onClose={onClose}>
      {q.error ? <p className="err">{(q.error as Error).message}</p> : !u ? <p className="mu">Loading…</p> : (
        <>
          <dl className="kv">
            <dt>Building</dt><dd>{u.property}{u.floor ? ` · floor ${u.floor}` : ""}</dd>
            <dt>Kind</dt><dd>{u.kind}{u.areaSqm != null ? ` · ${u.areaSqm.toLocaleString("en-US")} m²` : ""}</dd>
            <dt>Occupancy</dt><dd>{u.occupancy}{u.status === "Inactive" ? " · inactive" : ""}</dd>
            {u.ownerName && <><dt>Owner</dt><dd>{u.ownerName}</dd></>}
            {u.tenantName && <><dt>Tenant</dt><dd>{u.tenantName}</dd></>}
            {u.notes && <><dt>Notes</dt><dd>{u.notes}</dd></>}
          </dl>
          <div className="row" style={{ marginTop: 8 }}>
            {(user?.tabs.wos ?? 0) >= 2 && <button className="cta sm" onClick={() => setWo({ property: u.property, unitId: u.id, tenant: u.tenantName || u.ownerName, location: u.code })}>+ Work order</button>}
            {canEdit && <button className="lnk" onClick={() => setEditing(true)}>Edit unit</button>}
            {canEdit && <Link to={`/portal-access?unitId=${u.id}`}>Portal access</Link>}
            <span className="spacer" />
            {canEdit && !u.meterCount && !u.assetCount && !u.workOrders.length && <button className="lnk" onClick={() => del.mutate()}>Delete</button>}
          </div>
          {err && <p className="err">{err}</p>}
          <h3>Work orders</h3>
          {!u.workOrders.length ? <p className="mu">None yet.</p> : u.workOrders.map((w) => (
            <div key={w.id} className="row click" style={{ padding: "4px 0", cursor: "pointer" }} onClick={() => setOpenWo(w.id)}>
              <StatusPill s={w.status} /><span>{w.ticket}</span><span className="wrap">{w.title}</span><span className="spacer" /><small className="mu">{fmtDate(w.dateOpened ?? "")}</small>
            </div>
          ))}
          <h3>Meters</h3>
          {!u.meters.length ? <p className="mu">No meter linked to this unit.</p> : u.meters.map((m) => <div key={m.id}><Link to={`/meters?meter=${m.id}`}>{m.code}</Link> <span className="mu">{m.utility} · {m.meterClass}</span></div>)}
          <h3>Equipment in this unit</h3>
          {!u.assets.length ? <p className="mu">None recorded.</p> : u.assets.map((a) => <div key={a.id}><button className="lnk" onClick={() => onOpenAsset(a.id)}>{a.tag} · {a.name}</button> <span className="mu">{a.category}{a.status !== "In service" ? " · " + a.status : ""}</span></div>)}
        </>
      )}
    </Sheet>
  );
}

// ---------------- equipment ----------------
export function Equipment({ onOpen }: { onOpen: (id: string) => void }) {
  const { list, building } = useBuildingChoice();
  const canEdit = useCanEdit();
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("Active");
  const [adding, setAdding] = useState(false);
  const qs = building === "All" ? "" : `?property=${encodeURIComponent(building)}`;
  const q = useQuery({ queryKey: ["assets", qs], queryFn: () => api.get<AssetDTO[]>(`/assets/items${qs}`) });
  const rows = useMemo(() => {
    const s = search.trim().toLowerCase();
    return (q.data ?? []).filter((a) => (status === "All" || (status === "Active" ? a.status !== "Retired" : a.status === status))
      && (!s || [a.tag, a.name, a.category, a.location, a.unitCode ?? "", a.make, a.model, a.serial, a.property].some((x) => x.toLowerCase().includes(s))));
  }, [q.data, search, status]);
  if (q.error) return <ErrorBox error={q.error} />;
  const many = building === "All" && list.length > 1;
  return (
    <div className="card">
      <div className="row">
        <input className="in" style={{ flex: 1 }} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tag, name, category, location or serial" />
        <select className="in" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="Active">Not retired</option>{ASSET_STATUSES.map((s) => <option key={s}>{s}</option>)}<option>All</option>
        </select>
        {canEdit && list.length > 0 && <button className="cta sm" onClick={() => setAdding(true)}>+ Equipment</button>}
      </div>
      {q.isLoading ? <p className="mu">Loading…</p> : !rows.length ? <p className="mu">{q.data?.length ? "Nothing matches." : "No equipment recorded yet."}</p> : (
        <Table head={[...(many ? ["Building"] : []), "Tag", "Name", "Category", "Unit / location", "Status", "Open WOs"]}>
          {rows.map((a) => (
            <tr key={a.id} className="click" onClick={() => onOpen(a.id)}>
              {many && <td>{a.property}</td>}
              <td><b>{a.tag}</b>{a.critical && <span className="pill r" style={{ marginLeft: 6 }}>Critical</span>}</td>
              <td className="wrap">{a.name}</td><td>{a.category || "–"}</td>
              <td className="wrap">{[a.unitCode, a.location].filter(Boolean).join(" · ") || "–"}</td>
              <td>{a.status === "In service" ? <span className="mu">In service</span> : <span className={"pill " + (a.status === "Down" ? "r" : "a")}>{a.status}</span>}</td>
              <td>{a.openWorkOrders ? <span className="pill a">{a.openWorkOrders}</span> : "–"}</td>
            </tr>
          ))}
        </Table>
      )}
      {!!rows.length && <p className="mu">{rows.length} item{rows.length === 1 ? "" : "s"}.</p>}
      {adding && <AssetEditor onClose={() => setAdding(false)} onSaved={onOpen} />}
    </div>
  );
}

function AssetEditor({ asset, onClose, onSaved }: { asset?: AssetDTO; onClose: () => void; onSaved?: (id: string) => void }) {
  const { list, current } = useBuildingChoice();
  const refresh = useRefresh();
  const [propertyId, setPropertyId] = useState(asset?.propertyId ?? current?.id ?? list[0]?.id ?? "");
  const pname = list.find((b) => b.id === propertyId)?.name ?? "";
  const lookup = useAssetLookup(pname);
  const [f, setF] = useState(() => ({
    tag: asset?.tag ?? "", name: asset?.name ?? "", category: asset?.category ?? "", trade: asset?.trade ?? "", unitId: asset?.unitId ?? "", parentId: asset?.parentId ?? "",
    location: asset?.location ?? "", make: asset?.make ?? "", model: asset?.model ?? "", serial: asset?.serial ?? "",
    installDate: asset?.installDate ?? "", warrantyUntil: asset?.warrantyUntil ?? "", critical: asset?.critical ?? false, status: asset?.status ?? "In service", notes: asset?.notes ?? "",
  }));
  const [err, setErr] = useState("");
  const set = (k: keyof typeof f, v: string | boolean) => setF((x) => ({ ...x, [k]: v }));
  const save = useMutation({
    mutationFn: () => {
      const body = { ...f, unitId: f.unitId || null, parentId: f.parentId || null, installDate: f.installDate || null, warrantyUntil: f.warrantyUntil || null };
      return asset ? api.patch<AssetDTO>(`/assets/items/${asset.id}`, body) : api.post<AssetDTO>("/assets/items", { ...body, propertyId });
    },
    onSuccess: (a) => { refresh(); onClose(); onSaved?.(a.id); },
    onError: (e) => setErr((e as Error).message),
  });
  return (
    <Sheet title={asset ? `Edit ${asset.tag}` : "New equipment"} onClose={onClose}>
      {!asset && list.length > 1 && <div className="ff"><span className="mu">Building</span><BuildingSelect buildings={list} value={propertyId} onChange={(v) => { setPropertyId(v); setF((x) => ({ ...x, unitId: "", parentId: "" })); }} /></div>}
      <div className="fgrid">
        <div className="ff"><span className="mu">Tag *</span><input value={f.tag} onChange={(e) => set("tag", e.target.value)} placeholder="e.g. I3-CH-01" /></div>
        <div className="ff"><span className="mu">Name *</span><input value={f.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Chiller 1" /></div>
        <div className="ff"><span className="mu">Category</span><select value={f.category} onChange={(e) => set("category", e.target.value)}><option value="">–</option>{[...new Set([...ASSET_CATEGORIES, f.category].filter(Boolean))].map((c) => <option key={c}>{c}</option>)}</select></div>
        <div className="ff"><span className="mu">Trade</span><select value={f.trade} onChange={(e) => set("trade", e.target.value)}><option value="">–</option>{TRADES.map((t) => <option key={t}>{t}</option>)}</select></div>
        <div className="ff"><span className="mu">Unit / space</span><select value={f.unitId} onChange={(e) => set("unitId", e.target.value)}><option value="">– Building / common area –</option>{(lookup.data?.units ?? []).map((u) => <option key={u.id} value={u.id}>{u.code}</option>)}</select></div>
        <div className="ff"><span className="mu">Part of</span><select value={f.parentId} onChange={(e) => set("parentId", e.target.value)}><option value="">–</option>{(lookup.data?.assets ?? []).filter((a) => a.id !== asset?.id).map((a) => <option key={a.id} value={a.id}>{a.tag} · {a.name}</option>)}</select></div>
        <div className="ff"><span className="mu">Location</span><input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="e.g. Roof deck" /></div>
        <div className="ff"><span className="mu">Status</span><select value={f.status} onChange={(e) => set("status", e.target.value)}>{ASSET_STATUSES.map((s) => <option key={s}>{s}</option>)}</select></div>
        <div className="ff"><span className="mu">Make</span><input value={f.make} onChange={(e) => set("make", e.target.value)} /></div>
        <div className="ff"><span className="mu">Model</span><input value={f.model} onChange={(e) => set("model", e.target.value)} /></div>
        <div className="ff"><span className="mu">Serial no.</span><input value={f.serial} onChange={(e) => set("serial", e.target.value)} /></div>
        <div className="ff"><span className="mu">Installed</span><input type="date" value={f.installDate} onChange={(e) => set("installDate", e.target.value)} /></div>
        <div className="ff"><span className="mu">Warranty until</span><input type="date" value={f.warrantyUntil} onChange={(e) => set("warrantyUntil", e.target.value)} /></div>
        <label className="row" style={{ marginTop: 22 }}><input type="checkbox" checked={f.critical} onChange={(e) => set("critical", e.target.checked)} /> Critical asset</label>
      </div>
      <div className="ff"><span className="mu">Notes</span><textarea className="in" rows={2} value={f.notes} onChange={(e) => set("notes", e.target.value)} /></div>
      {err && <p className="err">{err}</p>}
      <div className="row"><span className="spacer" /><button className="cta" disabled={save.isPending || !f.tag.trim() || f.name.trim().length < 2 || !propertyId} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save"}</button></div>
    </Sheet>
  );
}

export function AssetSheet({ id, onClose, onOpenAsset }: { id: string; onClose: () => void; onOpenAsset: (id: string) => void }) {
  const q = useQuery({ queryKey: ["asset", id], queryFn: () => api.get<AssetDetail>(`/assets/items/${id}`) });
  const canEdit = useCanEdit();
  const { user } = useAuth();
  const refresh = useRefresh();
  const [editing, setEditing] = useState(false);
  const [wo, setWo] = useState<WoPrefill | null>(null);
  const [openWo, setOpenWo] = useState<string | null>(null);
  const [err, setErr] = useState("");
  const del = useMutation({ mutationFn: () => api.del(`/assets/items/${id}`), onSuccess: () => { refresh(); onClose(); }, onError: (e) => setErr((e as Error).message) });
  const a = q.data;
  if (editing && a) return <AssetEditor asset={a} onClose={() => { setEditing(false); q.refetch(); }} />;
  if (wo) return <NewWorkOrderSheet buildings={[a!.property]} prefill={wo} onClose={() => setWo(null)} onCreated={(w) => { setWo(null); setOpenWo(w.id); q.refetch(); }} />;
  if (openWo) return <WorkOrderSheet id={openWo} onClose={() => { setOpenWo(null); q.refetch(); }} />;
  const warrantyOk = a?.warrantyUntil && a.warrantyUntil >= new Date().toISOString().slice(0, 10);
  return (
    <Sheet title={a ? `${a.tag} · ${a.name}` : "Equipment"} onClose={onClose}>
      {q.error ? <p className="err">{(q.error as Error).message}</p> : !a ? <p className="mu">Loading…</p> : (
        <>
          <dl className="kv">
            <dt>Building</dt><dd>{a.property}</dd>
            {a.unitCode && <><dt>Unit / space</dt><dd><Link to={`/configuration?unit=${a.unitId}`}>{a.unitCode}</Link></dd></>}
            {a.parentTag && <><dt>Part of</dt><dd><button className="lnk" onClick={() => onOpenAsset(a.parentId!)}>{a.parentTag}</button></dd></>}
            <dt>Status</dt><dd>{a.status}{a.critical ? " · critical asset" : ""}</dd>
            {(a.category || a.trade) && <><dt>Category</dt><dd>{[a.category, a.trade].filter(Boolean).join(" · ")}</dd></>}
            {a.location && <><dt>Location</dt><dd>{a.location}</dd></>}
            {(a.make || a.model || a.serial) && <><dt>Make / model / serial</dt><dd>{[a.make, a.model, a.serial].filter(Boolean).join(" · ")}</dd></>}
            {a.installDate && <><dt>Installed</dt><dd>{fmtDate(a.installDate)}</dd></>}
            {a.warrantyUntil && <><dt>Warranty</dt><dd>{warrantyOk ? "Until " : "Expired "}{fmtDate(a.warrantyUntil)}</dd></>}
            {a.notes && <><dt>Notes</dt><dd>{a.notes}</dd></>}
          </dl>
          <div className="row" style={{ marginTop: 8 }}>
            {(user?.tabs.wos ?? 0) >= 2 && a.status !== "Retired" && <button className="cta sm" onClick={() => setWo({ property: a.property, unitId: a.unitId ?? undefined, assetId: a.id, location: a.location, trade: a.trade, priority: a.critical ? "High" : undefined, title: `${a.name}: ` })}>+ Work order</button>}
            {canEdit && <button className="lnk" onClick={() => setEditing(true)}>Edit</button>}
            <span className="spacer" />
            {canEdit && !a.workOrders.length && !a.children.length && !a.meters.length && <button className="lnk" onClick={() => del.mutate()}>Delete</button>}
          </div>
          {err && <p className="err">{err}</p>}
          <h3>Work order history</h3>
          {!a.workOrders.length ? <p className="mu">None yet.</p> : a.workOrders.map((w) => (
            <div key={w.id} className="row" style={{ padding: "4px 0", cursor: "pointer" }} onClick={() => setOpenWo(w.id)}>
              <StatusPill s={w.status} /><span>{w.ticket}</span><span className="wrap">{w.title}</span><span className="spacer" /><small className="mu">{fmtDate(w.dateOpened ?? "")}</small>
            </div>
          ))}
          {!!a.children.length && <><h3>Parts / sub-assets</h3>{a.children.map((c) => <div key={c.id}><button className="lnk" onClick={() => onOpenAsset(c.id)}>{c.tag} · {c.name}</button> <span className="mu">{c.status}</span></div>)}</>}
          {!!a.meters.length && <><h3>Meters</h3>{a.meters.map((m) => <div key={m.id}><Link to={`/meters?meter=${m.id}`}>{m.code}</Link> <span className="mu">{m.meterClass}</span></div>)}</>}
        </>
      )}
    </Sheet>
  );
}
