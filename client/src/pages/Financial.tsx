import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { Level } from "@pmd/shared";
import { Card, nf, Pill, Table } from "../ui";
import { EditDataHint, Screen } from "./common";
import { useDashboard } from "../state";

export default function Financial() {
  const d = useDashboard().data;
  const th = d?.thresholds;
  const [sel, setSel] = useState<string>("");
  return (
    <Screen>
      {(props) => {
        const name = sel && props.some((p) => p.name === sel) ? sel : props[0].name;
        const p = props.find((x) => x.name === name)!;
        const yr = d!.asOf.slice(0, 4);
        const months = p.opex.months.filter((m) => m.month.startsWith(yr));
        const q = [1, 2, 3, 4].map((qq) => {
          const L = months.filter((m) => Math.ceil(+m.month.slice(5, 7) / 3) === qq);
          const withA = L.filter((m) => m.actual != null);
          const b = withA.reduce((s, m) => s + m.budget, 0), a = withA.reduce((s, m) => s + (m.actual ?? 0), 0);
          const vp = withA.length && b ? ((a - b) / b) * 100 : null;
          const lvl: Level = vp == null ? "g" : Math.abs(vp) > th!.ox.r ? "r" : Math.abs(vp) > th!.ox.a ? "a" : "g";
          return { qq, n: withA.length, t: L.length, b, a, vp, lvl };
        });
        return (
          <>
            <Card title="Budget utilisation, year to date" sub={`Operating expenses actual ÷ budget for months with an actual, ${yr}. Green ${th?.m11.a}% or less · Red over ${th?.m11.r}%.`}>
              <Table head={["Building", "Budget YTD", "Actual YTD", "Utilisation", "Status", "Latest reason"]}>
                {props.map((x) => {
                  const k = x.kpis.find((y) => y.key === "m11")!;
                  const note = [...x.opex.months].reverse().find((m) => m.reason || m.actionTaken);
                  return <tr key={x.name} className="click" onClick={() => setSel(x.name)}><td><b>{x.name}</b></td><td>{nf(x.opex.ytdBudget)}</td><td>{nf(x.opex.ytdActual)}</td><td>{k.value}</td><td><Pill level={k.level} /></td><td className="wrap">{note ? `${note.reason}${note.actionTaken ? " · " + note.actionTaken : ""}` : "–"}</td></tr>;
                })}
              </Table>
            </Card>
            <Card title={`${p.name} · monthly operating expenses`} right={props.length > 1 && <select className="in" value={name} onChange={(e) => setSel(e.target.value)}>{props.map((x) => <option key={x.name}>{x.name}</option>)}</select>}>
              {!months.length ? <p className="mu">No monthly figures entered yet. Enter them under Data › Operating expenses.</p> : (
                <>
                  <div className="chart">
                    <ResponsiveContainer>
                      <ComposedChart data={months.map((m) => ({ m: m.month, Budget: m.budget, Actual: m.actual }))}>
                        <CartesianGrid strokeDasharray="3 3" stroke="var(--ln)" />
                        <XAxis dataKey="m" tick={{ fill: "var(--mu)", fontSize: 11 }} />
                        <YAxis tick={{ fill: "var(--mu)", fontSize: 11 }} tickFormatter={(v) => (v / 1000).toFixed(0) + "k"} />
                        <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--ln)" }} formatter={(v: number) => nf(v)} />
                        <Legend wrapperStyle={{ fontSize: 12 }} />
                        <Bar dataKey="Actual" fill="#f26a1b" />
                        <Line dataKey="Budget" stroke="#14274e" strokeWidth={2} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <h3>Quarterly operating expense variance</h3>
                  <Table head={["Quarter", "Months with actual", "Budget", "Actual", "Variance", "Variance %", "Status"]}>
                    {q.map((o) => (
                      <tr key={o.qq}><td>Q{o.qq} {yr}</td><td>{o.n} of {o.t}</td><td>{o.n ? nf(o.b) : "–"}</td><td>{o.n ? nf(o.a) : "–"}</td><td>{o.n ? (o.a - o.b > 0 ? "+" : "") + nf(o.a - o.b) : "–"}</td><td>{o.vp == null ? "–" : (o.vp > 0 ? "+" : "") + o.vp.toFixed(1) + "%"}</td><td>{o.vp == null ? "–" : <Pill level={o.lvl}>{o.lvl === "g" ? `Within ±${th!.ox.a}%` : o.vp > 0 ? "Over budget" : "Under budget"}</Pill>}</td></tr>
                    ))}
                  </Table>
                </>
              )}
            </Card>
            <EditDataHint datasets={[["bg", "Operating expenses"], ["cc", "Condo Corp cash position"]]} />
          </>
        );
      }}
    </Screen>
  );
}
