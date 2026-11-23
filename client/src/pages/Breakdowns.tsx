import { useState } from "react";
import { BySection, Card, Pill, Table } from "../ui";
import { EditDataHint, fmtDate, Screen } from "./common";
import { useDashboard } from "../state";

export default function Breakdowns() {
  const th = useDashboard().data?.thresholds;
  const [sel, setSel] = useState<string | null>(null);
  return (
    <Screen>
      {(props) => {
        const p = props.find((x) => x.name === sel);
        const up = props.flatMap((x) => x.uptime.rows.map((r) => ({ ...r, p: x.name })));
        return (
          <>
            <Card title="Mean time to restore, MTTR" sub={`Total breakdown hours ÷ number of breakdowns, last 90 days, by building. Green ${th?.mt.a} h or less · Red over ${th?.mt.r} h. Tap a row for the asset breakdowns.`}>
              <Table head={["Building", "Breakdowns", "Downtime", "MTTR", "Worst asset", "Status"]}>
                {props.map((x) => {
                  const k = x.kpis.find((y) => y.key === "mt")!, b = x.kpis.find((y) => y.key === "m4")!;
                  return (
                    <tr key={x.name} className="click" onClick={() => setSel(sel === x.name ? null : x.name)}>
                      <td><b>{x.name}</b></td><td>{x.mttr.count}</td><td>{x.mttr.downtime} h</td><td>{k.value}</td><td><Pill level={b.level}>{b.value}</Pill></td><td><Pill level={k.level} /></td>
                    </tr>
                  );
                })}
              </Table>
              {p && (
                <>
                  <h3>{p.name} · breakdown log</h3>
                  <Table head={["Asset", "Start", "Restored", "Hours", "Cause", "Ticket", "Action taken", "Reason for delay"]}>
                    {p.breakdowns.map((b, i) => <tr key={i}><td>{b.asset}</td><td>{b.start}</td><td>{b.open ? <Pill level="r">Still down</Pill> : b.restored}</td><td>{b.hours}</td><td>{b.cause}</td><td>{b.ticket || "–"}</td><td className="wrap">{b.actionTaken || "–"}</td><td className="wrap">{b.delayReason || "–"}</td></tr>)}
                  </Table>
                </>
              )}
            </Card>
            <Card title="Critical systems uptime" sub={`Power, Water, Elevator, FDAS and AFSS for the latest month. Uptime = (planned hours − unplanned downtime) ÷ planned hours. Green ${th?.up.a}% or more. One interruption caps the rating at Amber; two or more at Red.`}>
              <Table head={["Building", "Month", "Uptime", "Interruptions", "Status"]}>
                {props.map((x) => { const k = x.kpis.find((y) => y.key === "up")!; return <tr key={x.name}><td><b>{x.name}</b></td><td>{x.uptime.month || "–"}</td><td>{k.value}</td><td>{x.uptime.interruptions}</td><td><Pill level={k.level} /></td></tr>; })}
              </Table>
              <h3>Systems with downtime</h3>
              <BySection props={props} items={up.filter((r) => r.downtime > 0 || r.interruptions > 0)} of={(r) => r.p} empty="No unplanned downtime recorded." render={(L) => (
                <Table head={["System", "Month", "Planned h", "Downtime h", "Interruptions", "Uptime", "Reason", "Action taken"]}>
                  {L.map((r) => <tr key={r.p + r.system}><td>{r.system}</td><td>{r.month}</td><td>{r.planned}</td><td>{r.downtime}</td><td>{r.interruptions}</td><td>{r.uptime.toFixed(2)}%</td><td className="wrap">{r.reason || "–"}</td><td className="wrap">{r.actionTaken || "–"}</td></tr>)}
                </Table>
              )} />
            </Card>
            <Card title="Breakdowns past target" sub="Assets still down, oldest first.">
              <BySection props={props} items={props.flatMap((x) => x.breakdowns.filter((b) => b.open).map((b) => ({ ...b, p: x.name })))} of={(b) => b.p} empty="No assets are down." render={(L) => (
                <Table head={["Asset", "Down since", "Hours", "Cause", "Reason for delay", "Action taken"]}>
                  {L.map((b, i) => <tr key={i}><td>{b.asset}</td><td>{fmtDate(b.start.slice(0, 10))}</td><td><Pill level="r">{b.hours} h</Pill></td><td>{b.cause}</td><td className="wrap">{b.delayReason || "–"}</td><td className="wrap">{b.actionTaken || "–"}</td></tr>)}
                </Table>
              )} />
            </Card>
            <EditDataHint datasets={[["b", "Breakdown log"], ["m", "Work orders"], ["up", "Critical systems uptime"], ["ar", "Asset register"]]} />
          </>
        );
      }}
    </Screen>
  );
}
