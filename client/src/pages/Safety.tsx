import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BySection, Card, Pill, Table } from "../ui";
import { EditDataHint, fmtDate, Screen } from "./common";
import { HC } from "./ConcernsWO";
import { useDashboard } from "../state";

export default function Safety() {
  const d = useDashboard().data;
  return (
    <Screen>
      {(props) => {
        const A = new Date(d!.asOf + "T08:00");
        const months: string[] = [];
        for (let i = 11; i >= 0; i--) { const m = new Date(A.getFullYear(), A.getMonth() - i, 1); months.push(m.getFullYear() + "-" + String(m.getMonth() + 1).padStart(2, "0")); }
        const data = months.map((m) => ({ m, ...Object.fromEntries(props.map((p) => [p.name, p.incidents.filter((x) => x.date.startsWith(m)).length])) }));
        const all = props.flatMap((p) => p.incidents.map((x) => ({ ...x, p: p.name })));
        return (
          <>
            <Card title="Monthly incident reduction" sub={`Incidents last month compared with the month before. Target ${d!.thresholds.s1.a}% reduction or more.`}>
              <Table head={["Building", "Result", "Status", "Detail"]}>
                {props.map((p) => { const k = p.kpis.find((x) => x.key === "s1")!; return <tr key={p.name}><td><b>{p.name}</b></td><td>{k.value}</td><td><Pill level={k.level} /></td><td className="wrap">{k.info}</td></tr>; })}
              </Table>
            </Card>
            <Card title="Incidents per month" sub="Last 12 months">
              <div className="chart">
                <ResponsiveContainer>
                  <BarChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" stroke="var(--ln)" />
                    <XAxis dataKey="m" tick={{ fill: "var(--mu)", fontSize: 11 }} />
                    <YAxis allowDecimals={false} tick={{ fill: "var(--mu)", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--ln)" }} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    {props.map((p, i) => <Bar key={p.name} dataKey={p.name} stackId="b" fill={HC[i % HC.length]} />)}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card title="Incident log" sub="Newest first. Major and Critical incidents are Red.">
              <BySection props={props} items={all} of={(x) => x.p} empty="No incidents recorded." render={(L) => (
                <Table head={["ID", "Date", "Type", "Severity", "Location", "What happened", "Reason", "Action taken", "Status"]}>
                  {L.map((x) => <tr key={x.p + x.id}><td>{x.id}</td><td>{fmtDate(x.date)}</td><td>{x.type}</td><td><Pill level={x.level}>{x.severity}</Pill></td><td>{x.location || "–"}</td><td className="wrap">{x.description || "–"}</td><td className="wrap">{x.reason || "–"}</td><td className="wrap">{x.actionTaken || "–"}</td><td>{x.status}</td></tr>)}
                </Table>
              )} />
            </Card>
            <EditDataHint datasets={[["inc", "Safety incident log"]]} />
          </>
        );
      }}
    </Screen>
  );
}
