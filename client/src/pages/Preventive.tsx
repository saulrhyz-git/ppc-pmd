import { BySection, Card, Legend, Pie, Pill, Table } from "../ui";
import { EditDataHint, fmtDate, Screen } from "./common";
import { useDashboard } from "../state";

export default function Preventive() {
  const th = useDashboard().data?.thresholds;
  return (
    <Screen>
      {(props) => {
        const flagged = props.flatMap((p) => p.pm.flagged.map((t) => ({ ...t, p: p.name })));
        return (
          <>
            <Card title="PM compliance" sub={`Share of PM tasks due last month that were done on or before the due date. Target ${th?.m6.a}%.`}>
              <Legend items={[["g", "On time"], ["r", "Late or missed"]]} />
              <div className="pg">
                {props.map((p) => {
                  const k = p.kpis.find((x) => x.key === "m6")!;
                  return <Pie key={p.name} name={p.name} parts={[[p.pm.onTime, "g"], [p.pm.total - p.pm.onTime, "r"]]} sub={<><div>{k.value} <Pill level={k.level} /></div><div className="mu">{p.pm.onTime} of {p.pm.total} tasks</div></>} />;
                })}
              </div>
            </Card>
            <Card title="Flagged PM tasks" sub="Done late = done after the due date. Overdue = past due and not done. Tasks on critical assets are marked for follow-up but do not change the PM compliance colour.">
              <p className="mu">{flagged.filter((t) => t.status === "Overdue").length} overdue · {flagged.filter((t) => t.status === "Done late").length} done late · {flagged.filter((t) => t.critical).length} on critical assets</p>
              <BySection props={props} items={flagged} of={(t) => t.p} empty="No late or missed PM tasks." render={(L) => (
                <Table head={["Task", "Asset", "Critical", "Due", "Done", "Status", "Reason", "Action taken"]}>
                  {L.map((t, i) => <tr key={i}><td>{t.task}</td><td>{t.asset}</td><td>{t.critical ? <Pill level="a">Yes</Pill> : "No"}</td><td>{fmtDate(t.due)}</td><td>{t.done ? fmtDate(t.done) : "–"}</td><td><Pill level={t.status === "Overdue" ? "r" : "a"}>{t.status} · {t.daysLate} d</Pill></td><td className="wrap">{t.reason || "–"}</td><td className="wrap">{t.actionTaken || "–"}</td></tr>)}
                </Table>
              )} />
            </Card>
            <EditDataHint datasets={[["pm", "PM sheet"], ["ar", "Asset register"]]} />
          </>
        );
      }}
    </Screen>
  );
}
