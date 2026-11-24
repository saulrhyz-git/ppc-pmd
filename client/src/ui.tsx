import { useEffect, useState, type ReactNode } from "react";
import type { Kpi, Level, PropertyResult } from "@pmd/shared";
import { usePhone } from "./pwa";

export const LBL: Record<Level, string> = { r: "Red", a: "Amber", g: "Green" };
export const nf = (n: number) => n.toLocaleString("en-US");

export function Pill({ level, children }: { level: Level; children?: ReactNode }) {
  return <span className={"pill " + level}>{children ?? LBL[level]}</span>;
}

export function Card({ title, sub, children, right }: { title?: ReactNode; sub?: ReactNode; children?: ReactNode; right?: ReactNode }) {
  return (
    <div className="card">
      {(title || right) && (
        <div className="row" style={{ marginBottom: 4 }}>
          {title && <h2 style={{ margin: 0 }}>{title}</h2>}
          <span className="spacer" />
          {right}
        </div>
      )}
      {sub && <p className="mu" style={{ marginTop: 4 }}>{sub}</p>}
      {children}
    </div>
  );
}

export function Sheet({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  const phone = usePhone();
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  return (
    <div className="ov" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
        {phone ? (
          <div className="sh">
            <button className="lnk" onClick={onClose} aria-label="Back" style={{ flex: "none" }}>‹ Back</button>
            <h2 style={{ margin: 0, flex: 1, minWidth: 0 }}>{title}</h2>
          </div>
        ) : (
          <div className="sh">
            <h2 style={{ margin: 0 }}>{title}</h2>
            <button className="lnk" onClick={onClose} aria-label="Close">✕ Close</button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}

export function KpiGrid({ kpis, onPick, redOnly }: { kpis: Kpi[]; onPick?: (k: Kpi) => void; redOnly?: boolean }) {
  return (
    <div className="grid">
      {kpis.filter((k) => !redOnly || k.level === "r").map((k) => (
        <div key={k.key} className={"kpi " + k.level} style={{ cursor: onPick ? "pointer" : undefined }} onClick={() => onPick?.(k)} title={k.info}>
          <span>{k.label}</span>
          <b style={k.value.length > 9 ? { fontSize: 15, padding: "4px 0" } : undefined}>{k.value}</b>
          <span style={{ display: "block", fontWeight: 600 }}>{k.target}</span>
          <Pill level={k.level} />
        </div>
      ))}
    </div>
  );
}

/** Groups items by section, then by building, like the prototype's tables. */
export function BySection<T>({ props, items, of, render, empty = "None." }: { props: PropertyResult[]; items: T[]; of: (x: T) => string; render: (list: T[]) => ReactNode; empty?: string }) {
  if (!items.length) return <p className="mu">{empty}</p>;
  const names = [...new Set(items.map(of))];
  if (names.length < 2) return <>{render(items)}</>;
  const sections = [...new Set(props.map((p) => p.section))];
  return (
    <>
      {sections.map((s) => {
        const ps = props.filter((p) => p.section === s && names.includes(p.name));
        if (!ps.length) return null;
        return (
          <div key={s}>
            <div className="gs">{s} section</div>
            {ps.map((p) => {
              const L = items.filter((x) => of(x) === p.name);
              return (
                <div key={p.name}>
                  <div className="gb">{p.name} <span className="mu">({L.length})</span></div>
                  {render(L)}
                </div>
              );
            })}
          </div>
        );
      })}
    </>
  );
}

export function Table({ head, children }: { head: ReactNode[]; children: ReactNode }) {
  return (
    <div className="w">
      <table>
        <thead><tr>{head.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function Pie({ parts, name, sub, onClick }: { parts: [number, Level | "n"][]; name: string; sub?: ReactNode; onClick?: () => void }) {
  const C: Record<string, string> = { g: "var(--g)", a: "var(--a)", r: "var(--r)", n: "var(--ln)" };
  const T = parts.reduce((s, p) => s + p[0], 0) || 1;
  let a = 0;
  const g = parts.filter((p) => p[0] > 0).map((p) => { const s = a; a += (p[0] / T) * 100; return `${C[p[1]]} ${s}% ${a}%`; }).join(",");
  return (
    <div className="pc" onClick={onClick} style={{ cursor: onClick ? "pointer" : undefined }}>
      <div className="pie" style={{ background: `conic-gradient(${g || "var(--ln) 0 100%"})` }} role="img" aria-label={name} />
      <b>{name}</b>
      {sub}
    </div>
  );
}

export function Legend({ items }: { items: [Level | "n", string][] }) {
  const C: Record<string, string> = { g: "var(--g)", a: "var(--a)", r: "var(--r)", n: "var(--ln)" };
  return <div className="lg">{items.map(([l, t]) => <span key={t}><i style={{ background: C[l] }} />{t}</span>)}</div>;
}

export const Loading = () => <div className="card"><p className="mu">Loading…</p></div>;
export const ErrorBox = ({ error }: { error: unknown }) => <div className="card"><p className="err">{error instanceof Error ? error.message : "Something went wrong"}</p></div>;

/**
 * A "danger zone" for deleting something: opens a box that explains what happens and only enables
 * the final button once the person types DELETE.
 */
export function DeleteConfirm({ label, explain, busy, error, onConfirm }: { label: string; explain: ReactNode; busy?: boolean; error?: string; onConfirm: () => void }) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  if (!open) return <button className="lnk" style={{ color: "var(--r)" }} onClick={() => setOpen(true)}>{label}</button>;
  return (
    <div className="card" style={{ borderColor: "var(--r)", margin: "10px 0" }}>
      <b style={{ color: "var(--r)" }}>{label}</b>
      <div className="mu" style={{ margin: "6px 0" }}>{explain}</div>
      <label className="ff"><span className="mu">Type DELETE to confirm</span><input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" /></label>
      <div className="row">
        <button className="cta sm" style={{ background: "var(--r)" }} disabled={busy || typed.trim().toUpperCase() !== "DELETE"} onClick={onConfirm}>{busy ? "Deleting…" : "Delete permanently"}</button>
        <button className="lnk" onClick={() => { setOpen(false); setTyped(""); }}>Cancel</button>
      </div>
      {error && <p className="err">{error}</p>}
    </div>
  );
}
