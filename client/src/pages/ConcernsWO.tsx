import { useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { TRADES, type PropertyResult } from "@pmd/shared";
import { BySection, Card, Legend as Lg, Pie, Pill, Table } from "../ui";
import { EditDataHint, fmtDate, Screen } from "./common";
import { ConcernsInboxCard } from "./ConcernsInbox";
import { useDashboard } from "../state";
import { useAuth } from "../auth";

export const HC = ["#14274e", "#f26a1b", "#12a150", "#7a5af8", "#06aed4", "#d92d20", "#f79009", "#667089", "#b54708", "#2e90fa"];
const SUBS = [["sum", "Concerns Summary"], ["rw", "Reactive vs Preventive"], ["lt", "Leadtime Compliance"], ["wo", "Work Orders"], ["rc", "Recurring Concerns"]] as const;
type Sub = (typeof SUBS)[number][0];

function HistoryCharts({ props }: { props: PropertyResult[] }) {
  const d = useDashboard().data!;
  const [b, setB] = useState("All");
  const months = d.history.months;
  const byB = months.map((m, i) => ({ m, ...Object.fromEntries(props.map((p) => [p.name, d.history.byProperty[p.name]?.[i] ?? 0])) }));
  const src = b === "All" ? props.map((p) => p.name) : [b];
  const byT = months.map((m, i) => ({ m, ...Object.fromEntries(TRADES.map((t) => [t, src.reduce((s, n) => s + (d.history.byTrade[n]?.[t]?.[i] ?? 0), 0)])) }));
  const trades = TRADES.filter((t) => byT.some((r) => (r as unknown as Record<string, number>)[t] > 0));
  return (
    <div className="secrow" style={{ ["--n" as string]: 2 }}>
      <Card title="Monthly concerns history" sub="Last 6 months · bar per building">
        <div className="chart">
          <ResponsiveContainer>
            <BarChart data={byB}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ln)" />
              <XAxis dataKey="m" tick={{ fill: "var(--mu)", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--mu)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--ln)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {props.map((p, i) => <Bar key={p.name} dataKey={p.name} fill={HC[i % HC.length]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
      <Card title="Concerns by trade" sub="Last 6 months · stacked by trade" right={props.length > 1 && (
        <select className="in" value={b} onChange={(e) => setB(e.target.value)}><option value="All">All buildings</option>{props.map((p) => <option key={p.name}>{p.name}</option>)}</select>
      )}>
        <div className="chart">
          <ResponsiveContainer>
            <BarChart data={byT}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--ln)" />
              <XAxis dataKey="m" tick={{ fill: "var(--mu)", fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--mu)", fontSize: 11 }} />
              <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--ln)" }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {trades.map((t, i) => <Bar key={t} dataKey={t} stackId="t" fill={HC[i % HC.length]} />)}
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>
    </div>
  );
}

function Summary({ props }: { props: PropertyResult[] }) {
  const th = useDashboard().data!.thresholds;
  const open = props.flatMap((p) => p.slips.filter((s) => !s.closed).map((s) => ({ ...s, p: p.name })));
  open.sort((a, b) => b.ageHours - a.ageHours);
  return (
    <>
      <HistoryCharts props={props} />
      <ConcernsInboxCard />
      <Card title="Concern slips" sub="Every client concern is logged on a concern slip. A slip is closed only when the concern is actually resolved; recording the action plan does not close it.">
        <Table head={["Building", "Received", "Responded", "Avg response", "Resolved in time", "Open slips"]}>
          {props.map((p) => {
            const k = p.kpis.find((x) => x.key === "cx")!, c = p.kpis.find((x) => x.key === "cr")!;
            return (
              <tr key={p.name}>
                <td><b>{p.name}</b></td>
                <td>{p.slips.length}</td>
                <td>{p.slips.filter((s) => s.responded).length}</td>
                <td><Pill level={k.level}>{k.value}</Pill></td>
                <td><Pill level={c.level}>{c.value}</Pill></td>
                <td>{p.slips.filter((s) => !s.closed).length}</td>
              </tr>
            );
          })}
        </Table>
        <h3>Open slips</h3>
        <BySection props={props} items={open} of={(s) => s.p} empty="No open concern slips." render={(L) => (
          <Table head={["Control no.", "Received", "Trade", "Company", "Concern", "Age", "State", "Action taken"]}>
            {L.map((s) => (
              <tr key={s.p + s.id}>
                <td>{s.id}</td><td>{fmtDate(s.received)}</td><td>{s.trade}</td><td>{s.company || "–"}</td><td className="wrap">{s.concern}</td>
                <td>{s.ageHours > th.rs.a ? <Pill level="r">{Math.round(s.ageHours)} h</Pill> : Math.round(s.ageHours) + " h"}</td>
                <td>{s.state}{s.issues.length ? <div className="err">{s.issues.join("; ")}</div> : null}</td>
                <td className="wrap">{s.actionTaken || "–"}</td>
              </tr>
            ))}
          </Table>
        )} />
      </Card>
    </>
  );
}

function Reactive({ props }: { props: PropertyResult[] }) {
  const th = useDashboard().data!.thresholds;
  const [sel, setSel] = useState<string | null>(null);
  const p = props.find((x) => x.name === sel);
  return (
    <Card title="Reactive vs preventive work orders" sub={`Reactive share of the work completed last month (reactive, preventive and requests/improvement). Green ${th.rw.a}% or less · Red over ${th.rw.r}%. Tap a row for the completed work.`}>
      <Table head={["Building", "Reactive", "Preventive", "Requests / Improvement", "Reactive %", "Status"]}>
        {props.map((p) => {
          const k = p.kpis.find((x) => x.key === "rw")!;
          return (
            <tr key={p.name} className="click" onClick={() => setSel(p.name === sel ? null : p.name)}>
              <td><b>{p.name}</b></td><td>{p.reactive.reactive}</td><td>{p.reactive.preventive}</td><td>{p.reactive.requests}</td><td>{k.value}</td><td><Pill level={k.level} /></td>
            </tr>
          );
        })}
      </Table>
      {p && (
        <>
          <h3>{p.name} · work completed last month ({p.completedWork.length})</h3>
          <Table head={["ID", "Type", "Date", "Description", "Asset", "Owner", "Source"]}>
            {p.completedWork.map((c, i) => <tr key={i}><td>{c.id}</td><td>{c.type}</td><td>{fmtDate(c.date)}</td><td className="wrap">{c.description}</td><td>{c.asset}</td><td>{c.owner}</td><td>{c.source}</td></tr>)}
          </Table>
        </>
      )}
    </Card>
  );
}

function Leadtime({ props }: { props: PropertyResult[] }) {
  const th = useDashboard().data!.thresholds;
  return (
    <Card title="Concerns Agreed Leadtime Compliance" sub={`Closed within target vs closed late or still open past target. Target ${th.m1.a}%.`}>
      <Lg items={[["g", "Within target"], ["r", "Late or past target"]]} />
      <div className="pg">
        {props.map((p) => {
          const k = p.kpis.find((x) => x.key === "m1")!;
          const past = p.openWorkOrders.filter((w) => w.pastDays > 0).length;
          const late = p.closedInPeriod.total - p.closedInPeriod.onTime + past;
          return <Pie key={p.name} name={p.name} parts={[[p.closedInPeriod.onTime, "g"], [late, "r"]]} sub={<div>{k.value} <Pill level={k.level} /></div>} />;
        })}
      </div>
    </Card>
  );
}

function WorkOrders({ props }: { props: PropertyResult[] }) {
  const all = props.flatMap((p) => p.openWorkOrders.map((w) => ({ ...w, p: p.name })));
  return (
    <Card title="Open work orders" sub="Sorted past-target first, then oldest. Aged (over 7 days) is shown separately from past target." right={<Link to="/work-orders">Manage work orders →</Link>}>
      <BySection props={props} items={all} of={(w) => w.p} empty="No open work orders." render={(L) => (
        <Table head={["Ticket", "Asset", "Company", "Chargeable", "Type", "Work request", "Reason", "Action taken", "Age", "Past target", "Owner"]}>
          {L.map((w) => (
            <tr key={w.p + w.ticket}>
              <td>{w.ticket}</td><td>{w.asset}</td><td>{w.tenant || "–"}</td><td>{w.chargeable === "Yes" ? <Pill level="a">Yes</Pill> : w.chargeable || "–"}</td><td>{w.category}</td>
              <td className="wrap">{w.description}</td><td className="wrap">{w.reason || (w.pastDays ? <span className="err">Reason needed</span> : "–")}</td><td className="wrap">{w.actionTaken || "–"}</td>
              <td>{w.ageDays > 7 ? <Pill level="a">{w.ageDays} d</Pill> : w.ageDays + " d"}</td><td>{w.pastDays ? <Pill level="r">{w.pastDays} d</Pill> : "–"}</td><td>{w.owner}</td>
            </tr>
          ))}
        </Table>
      )} />
    </Card>
  );
}

function RecurringView({ props }: { props: PropertyResult[] }) {
  const th = useDashboard().data!.thresholds;
  const all = props.flatMap((p) => p.recurring.map((r) => ({ ...r, p: p.name })));
  return (
    <Card title="Recurring concerns" sub={`Open work orders on the same asset and category: ${th.m5.r} or more is Red (permanent-fix candidate); ${th.m5.a} is a pre-warning.`}>
      <BySection props={props} items={all} of={(r) => r.p} empty="No recurring concerns." render={(L) => (
        <Table head={["Asset", "Category", "Open tickets", "Flag", "Reason", "Action taken"]}>
          {L.map((r) => <tr key={r.p + r.asset + r.category}><td>{r.asset}</td><td>{r.category}</td><td>{r.count}</td><td><Pill level={r.level}>{r.level === "r" ? "Red permanent-fix candidate" : "Pre-warning"}</Pill></td><td className="wrap">{r.reason || "–"}</td><td className="wrap">{r.actionTaken || "–"}</td></tr>)}
        </Table>
      )} />
    </Card>
  );
}

export default function ConcernsWO() {
  const [sub, setSub] = useState<Sub>("sum");
  const { user } = useAuth();
  return (
    <Screen>
      {(props) => (
        <>
          <div className="tabs">{SUBS.map(([k, l]) => <button key={k} className={sub === k ? "on" : ""} onClick={() => setSub(k)}>{l}</button>)}</div>
          {sub === "sum" && <Summary props={props} />}
          {sub === "rw" && <Reactive props={props} />}
          {sub === "lt" && <Leadtime props={props} />}
          {sub === "wo" && <WorkOrders props={props} />}
          {sub === "rc" && <RecurringView props={props} />}
          {user && <EditDataHint datasets={[["cs", "Concern slips"], ["tr", "Tenant register"]]} />}
        </>
      )}
    </Screen>
  );
}
