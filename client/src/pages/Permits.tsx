import { BySection, Card, Pill, Table } from "../ui";
import { EditDataHint, fmtDate, Screen } from "./common";
import { useDashboard } from "../state";

export default function Permits() {
  const th = useDashboard().data?.thresholds;
  return (
    <Screen>
      {(props) => {
        const all = props.flatMap((p) => p.permits.map((x) => ({ ...x, p: p.name })));
        return (
          <>
            <div className="grid" style={{ marginBottom: 12 }}>
              <div className="kpi r"><span>Expired</span><b>{all.filter((x) => x.days < 0).length}</b></div>
              <div className="kpi a"><span>Expiring within {th?.m7.a} days</span><b>{all.filter((x) => x.days >= 0 && x.level === "a").length}</b></div>
              <div className="kpi g"><span>Valid</span><b>{all.filter((x) => x.level === "g").length}</b></div>
            </div>
            <Card title="Permits and certificates" sub={`Red when expired, Amber when it expires within ${th?.m7.a} days. Sorted by expiry.`}>
              <BySection props={props} items={all} of={(x) => x.p} empty="No permits on file." render={(L) => (
                <Table head={["Permit", "Agency", "Expiry", "Days left", "Renewal status", "Owner", "Reason", "Action taken"]}>
                  {L.map((x, i) => <tr key={i}><td><b>{x.permit}</b></td><td>{x.agency || "–"}</td><td>{fmtDate(x.expiry)}</td><td><Pill level={x.level}>{x.days < 0 ? `Expired ${-x.days} d` : x.days + " d"}</Pill></td><td>{x.renewalStatus || "–"}</td><td>{x.owner || "–"}</td><td className="wrap">{x.reason || "–"}</td><td className="wrap">{x.actionTaken || "–"}</td></tr>)}
                </Table>
              )} />
            </Card>
            <EditDataHint datasets={[["pr", "Permit register"]]} />
          </>
        );
      }}
    </Screen>
  );
}
