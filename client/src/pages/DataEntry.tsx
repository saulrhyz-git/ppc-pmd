import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { canEditData, DATASET_BY_KEY, DATASETS, toCsv, validateRow, type Column, type DatasetKey, type Row } from "@pmd/shared";
import { api, type DataRow } from "../api";
import { useAuth } from "../auth";
import { useMeta } from "../state";
import { Card } from "../ui";

function Cell({ c, value, onChange, buildings }: { c: Column; value: string; onChange: (v: string) => void; buildings: string[] }) {
  const sel = { minWidth: c.key === "property" ? 120 : 110 };
  if (c.key === "property") return <select style={sel} value={value} onChange={(e) => onChange(e.target.value)}><option value="">–</option>{buildings.map((b) => <option key={b}>{b}</option>)}</select>;
  if (c.type === "enum") return <select style={sel} value={value} onChange={(e) => onChange(e.target.value)}><option value="">–</option>{c.options!.filter(Boolean).map((o) => <option key={o}>{o}</option>)}</select>;
  if (c.type === "yesno") return <select style={{ minWidth: 70 }} value={value} onChange={(e) => onChange(e.target.value)}><option value="">–</option><option>Yes</option><option>No</option></select>;
  const type = c.type === "date" ? "date" : c.type === "month" ? "month" : c.type === "number" ? "number" : "text";
  return <input type={type} value={value} placeholder={c.type === "datetime" ? "YYYY-MM-DD HH:MM" : ""} onChange={(e) => onChange(e.target.value)} style={{ minWidth: c.type === "longtext" ? 220 : c.type === "number" ? 90 : 120 }} />;
}

export default function DataEntry() {
  const { user } = useAuth();
  const meta = useMeta();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const key = (sp.get("ds") && sp.get("ds")! in DATASET_BY_KEY ? sp.get("ds") : "cs") as DatasetKey;
  const def = DATASET_BY_KEY[key];
  const [building, setBuilding] = useState("All");
  const [edits, setEdits] = useState<Record<string, Row>>({});
  const [draft, setDraft] = useState<Row>({});
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({});
  const [importMode, setImportMode] = useState<"append" | "replace">("append");
  const editable = !!user && canEditData(user);

  const rowsQ = useQuery({ queryKey: ["rows", key], queryFn: () => api.get<DataRow[]>(`/datasets/${key}/rows`) });
  const scope = useQuery({ queryKey: ["concern-buildings"], queryFn: () => api.get<string[]>("/concerns/buildings") });
  const buildings = scope.data ?? [];
  const rows = useMemo(() => (rowsQ.data ?? []).filter((r) => building === "All" || r.property === building), [rowsQ.data, building]);

  const refresh = () => { qc.invalidateQueries({ queryKey: ["rows", key] }); qc.invalidateQueries({ queryKey: ["dashboard"] }); };
  const fail = (e: unknown) => setMsg({ err: (e as Error).message });
  const save = useMutation({ mutationFn: (r: DataRow) => api.put(`/datasets/${key}/rows/${r.id}`, { data: edits[r.id] }), onSuccess: (_d, r) => { setEdits((e) => { const n = { ...e }; delete n[r.id]; return n; }); setMsg({ ok: "Saved." }); refresh(); }, onError: fail });
  const del = useMutation({ mutationFn: (id: string) => api.del(`/datasets/${key}/rows/${id}`), onSuccess: () => { setMsg({ ok: "Deleted." }); refresh(); }, onError: fail });
  const add = useMutation({ mutationFn: () => api.post(`/datasets/${key}/rows`, { data: { ...draft, property: draft.property || (building !== "All" ? building : buildings[0]) } }), onSuccess: () => { setDraft({}); setMsg({ ok: "Row added." }); refresh(); }, onError: fail });
  const imp = useMutation({
    mutationFn: (csv: string) => api.post<{ imported: number; rejected: { line: number; message: string }[] }>(`/datasets/${key}/import`, { csv, mode: importMode }),
    onSuccess: (r) => { setMsg(r.rejected.length ? { ok: `${r.imported} rows imported.`, err: `${r.rejected.length} rows skipped: ` + r.rejected.slice(0, 8).map((x) => `line ${x.line}: ${x.message}`).join("; ") + (r.rejected.length > 8 ? "; …" : "") } : { ok: `${r.imported} rows imported.` }); refresh(); },
    onError: fail,
  });

  const template = () => {
    const blob = new Blob([toCsv(key, [])], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${key}-template.csv`;
    a.click();
  };
  const onFile = async (f: File | undefined) => { if (f) imp.mutate(await f.text()); };
  const draftProp = draft.property || (building !== "All" ? building : buildings[0] || "");
  const draftErr = Object.values(draft).some(Boolean) ? validateRow(key, { ...draft, property: draftProp }) : null;

  return (
    <>
      <Card title="Data entry" sub={`Registers and logs behind every dashboard. ${editable ? "Edit a cell and press Save on that row; add new records in the last row." : "You can view these records. Editing needs data-edit access."} Data as of ${meta.data?.asOf ?? "…"}.`}>
        <div className="row">
          <select className="in" value={key} onChange={(e) => { setSp({ ds: e.target.value }); setEdits({}); setDraft({}); setMsg({}); }}>
            {DATASETS.map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
          </select>
          <select className="in" value={building} onChange={(e) => setBuilding(e.target.value)}>
            <option value="All">All buildings</option>
            {buildings.map((b) => <option key={b}>{b}</option>)}
          </select>
          <span className="spacer" />
          <a className="pill" style={{ background: "var(--navy)", textDecoration: "none" }} href={`/api/datasets/${key}/export.csv`}>⬇ Export CSV</a>
          <button className="lnk" onClick={template}>Blank template</button>
        </div>
        <p className="mu">{def.description}</p>
        {editable && (
          <div className="row" style={{ margin: "6px 0" }}>
            <b>Import CSV</b>
            <select className="in" value={importMode} onChange={(e) => setImportMode(e.target.value as "append")}>
              <option value="append">Add to existing rows</option>
              <option value="replace">Replace rows for the buildings in the file</option>
            </select>
            <input type="file" accept=".csv,text/csv" onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ""; }} />
            {imp.isPending && <span className="mu">Importing…</span>}
          </div>
        )}
        {msg.ok && <p className="okmsg">{msg.ok}</p>}
        {msg.err && <p className="err">{msg.err}</p>}
      </Card>
      <div className="card" style={{ padding: 0 }}>
        <div className="w" style={{ maxHeight: "70vh" }}>
          <table className="gt">
            <thead>
              <tr><th>#</th>{def.columns.map((c) => <th key={c.key}>{c.label}{c.required ? " *" : ""}</th>)}{editable && <th />}</tr>
            </thead>
            <tbody>
              {rowsQ.isLoading && <tr><td colSpan={99} className="gnum">Loading…</td></tr>}
              {rows.map((r, i) => {
                const e = edits[r.id];
                const cur = e ?? r.data;
                return (
                  <tr key={r.id}>
                    <td className="gnum">{i + 1}</td>
                    {def.columns.map((c) => (
                      <td key={c.key} className={e && e[c.key] !== r.data[c.key] ? "ch" : ""}>
                        {editable ? <Cell c={c} value={cur[c.key] ?? ""} buildings={buildings} onChange={(v) => setEdits((x) => ({ ...x, [r.id]: { ...cur, [c.key]: v } }))} /> : <span style={{ padding: 8, display: "block" }}>{cur[c.key] || ""}</span>}
                      </td>
                    ))}
                    {editable && (
                      <td className="gxc" style={{ whiteSpace: "nowrap" }}>
                        {e && <button className="cta sm" onClick={() => save.mutate(r)} disabled={save.isPending}>Save</button>}
                        {e && <button className="gx" title="Undo changes" onClick={() => setEdits((x) => { const n = { ...x }; delete n[r.id]; return n; })}>↺</button>}
                        <button className="gx" title="Delete row" onClick={() => { if (confirm("Delete this row?")) del.mutate(r.id); }}>✕</button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {editable && (
                <tr className="gnew">
                  <td className="gnum">+</td>
                  {def.columns.map((c) => <td key={c.key}><Cell c={c} buildings={buildings} value={c.key === "property" ? draftProp : draft[c.key] ?? ""} onChange={(v) => setDraft((x) => ({ ...x, [c.key]: v }))} /></td>)}
                  <td className="gxc"><button className="cta sm" disabled={!!draftErr || !Object.values(draft).some(Boolean) || add.isPending} onClick={() => add.mutate()}>Add</button></td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {editable && draftErr && <p className="err" style={{ padding: "0 12px 10px" }}>New row: {draftErr}</p>}
        <p className="mu" style={{ padding: "0 12px 10px" }}>{rows.length} row{rows.length === 1 ? "" : "s"}. Dates as YYYY-MM-DD, date-times as YYYY-MM-DD HH:MM, months as YYYY-MM.</p>
      </div>
    </>
  );
}
