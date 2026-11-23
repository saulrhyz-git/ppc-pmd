import { BySection, Card, nf, Pill, Table } from "../ui";
import { EditDataHint, fmtDate, Screen } from "./common";
import { useDashboard } from "../state";

export default function Contracts() {
  const th = useDashboard().data?.thresholds;
  return (
    <Screen>
      {(props) => {
        const all = props.flatMap((p) => p.contracts.map((x) => ({ ...x, p: p.name })));
        return (
          <>
            <div className="grid" style={{ marginBottom: 12 }}>
              <div className="kpi r"><span>Expired</span><b>{all.filter((x) => x.days < 0).length}</b></div>
              <div className="kpi a"><span>Ending within {th?.ct.a} days</span><b>{all.filter((x) => x.days >= 0 && x.level === "a").length}</b></div>
              <div className="kpi g"><span>Active</span><b>{all.filter((x) => x.level === "g").length}</b></div>
              <div className="kpi g"><span>Total value</span><b style={{ fontSize: 15 }}>{nf(all.reduce((s, x) => s + x.value, 0))}</b></div>
            </div>
            <Card title="Service and supply contracts" sub={`Red when expired, Amber when it ends within ${th?.ct.a} days. Sorted by end date.`}>
              <BySection props={props} items={all} of={(x) => x.p} empty="No contracts on file." render={(L) => (
                <Table head={["Contract", "Vendor", "Type", "End", "Days left", "Value", "Renewal status", "Owner", "Action taken"]}>
                  {L.map((x, i) => <tr key={i}><td><b>{x.name}</b><div className="mu">{x.no}</div></td><td>{x.vendor || "–"}</td><td>{x.type || "–"}</td><td>{fmtDate(x.end)}</td><td><Pill level={x.level}>{x.days < 0 ? `Expired ${-x.days} d` : x.days + " d"}</Pill></td><td>{nf(x.value)}</td><td>{x.renewalStatus || "–"}</td><td>{x.owner || "–"}</td><td className="wrap">{x.actionTaken || "–"}</td></tr>)}
                </Table>
              )} />
            </Card>
            <EditDataHint datasets={[["ct", "Contract register"]]} />
          </>
        );
      }}
    </Screen>
  );
}
