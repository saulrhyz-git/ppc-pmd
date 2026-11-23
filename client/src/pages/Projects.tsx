import { useState } from "react";
import type { Project } from "@pmd/shared";
import { BySection, Card, nf, Pill, Sheet, Table } from "../ui";
import { EditDataHint, fmtDate, Screen } from "./common";
import { useDashboard } from "../state";

const ORD: Record<string, number> = { Delayed: 0, "At risk": 1, "On hold": 2, "Not started": 3, "On time": 4, Completed: 5 };

function Bar({ j }: { j: Project }) {
  const c = j.level === "r" ? "var(--r)" : j.level === "a" ? "var(--a)" : "var(--g)";
  return (
    <>
      <div style={{ position: "relative", background: "var(--ln)", height: 10, borderRadius: 5, minWidth: 130, margin: "6px 0" }}>
        <div style={{ width: j.pct + "%", height: "100%", background: c, borderRadius: 5 }} />
        <div style={{ position: "absolute", left: j.plan + "%", top: -4, bottom: -4, width: 2, background: "var(--tx)" }} />
      </div>
      <span className="mu">{j.pct}% done · plan {j.plan}%</span>
    </>
  );
}

function Detail({ j, onClose }: { j: Project & { p: string }; onClose: () => void }) {
  const ev = (j.budget * j.pct) / 100, cpi = j.spent > 0 ? ev / j.spent : null, eac = cpi ? j.budget / cpi : j.budget;
  const op = j.budget ? Math.round(((eac - j.budget) / j.budget) * 1000) / 10 : 0;
  return (
    <Sheet title={`${j.id} · ${j.name}`} onClose={onClose}>
      <p><Pill level={j.level}>{j.status}</Pill> <span className="mu">{j.p} · {j.type}</span></p>
      <Bar j={j} />
      <dl className="kv" style={{ marginTop: 10 }}>
        <dt>Owner</dt><dd>{j.owner || "–"}</dd>
        <dt>Schedule</dt><dd>{fmtDate(j.start)} → {fmtDate(j.finish)}{j.daysLate ? ` (${j.daysLate} d overdue)` : j.forecastDays && j.forecastDays > 0 ? ` (+${j.forecastDays} d forecast)` : ""}</dd>
        <dt>Next milestone</dt><dd>{j.nextMilestone || "–"}</dd>
        <dt>Budget</dt><dd>{nf(j.budget)}</dd>
        <dt>Spent</dt><dd>{nf(j.spent)}</dd>
        <dt>Forecast at completion</dt><dd>{j.budget ? `${nf(Math.round(eac))} (${op > 0 ? "+" : ""}${op}%)` : "–"}</dd>
        <dt>Reason for delay</dt><dd>{j.delayReason || "–"}</dd>
        <dt>Action taken</dt><dd>{j.actionTaken || "–"}</dd>
      </dl>
    </Sheet>
  );
}

export default function Projects() {
  const th = useDashboard().data?.thresholds;
  const [f, setF] = useState("All");
  const [sel, setSel] = useState<(Project & { p: string }) | null>(null);
  return (
    <Screen>
      {(props) => {
        const all = props.flatMap((p) => p.projects.map((j) => ({ ...j, p: p.name }))).sort((a, b) => ORD[a.status] - ORD[b.status] || b.daysLate + (b.forecastDays ?? 0) - (a.daysLate + (a.forecastDays ?? 0)));
        const cnt = (s: string[]) => all.filter((j) => s.includes(j.status)).length;
        const shown = f === "All" ? all : all.filter((j) => j.type === f);
        return (
          <>
            <div className="grid" style={{ marginBottom: 12 }}>
              <div className="kpi r"><span>Delayed</span><b>{cnt(["Delayed"])}</b><span className="mu">Over {th?.pj.r} pts behind plan or past finish</span></div>
              <div className="kpi a"><span>At risk / on hold</span><b>{cnt(["At risk", "On hold"])}</b><span className="mu">{th?.pj.a}–{th?.pj.r} pts behind plan</span></div>
              <div className="kpi g"><span>On time / not started</span><b>{cnt(["On time", "Not started"])}</b></div>
              <div className="kpi g"><span>Completed</span><b>{cnt(["Completed"])}</b></div>
            </div>
            <Card title="CAPEX and projects" sub="Progress against the straight-line plan between start and finish dates. Tap a row for budget compliance." right={<div className="tabs" style={{ margin: 0 }}>{["All", "CAPEX", "Project"].map((x) => <button key={x} className={f === x ? "on" : ""} onClick={() => setF(x)}>{x}</button>)}</div>}>
              <BySection props={props} items={shown} of={(j) => j.p} empty="No projects on file." render={(L) => (
                <Table head={["Project", "Type", "Progress", "Status", "Finish", "Budget", "Spent", "Reason for delay"]}>
                  {L.map((j) => <tr key={j.p + j.id} className="click" onClick={() => setSel(j)}><td><b>{j.name}</b><div className="mu">{j.id}</div></td><td>{j.type}</td><td style={{ minWidth: 160 }}><Bar j={j} /></td><td><Pill level={j.level}>{j.status}</Pill></td><td>{fmtDate(j.finish)}</td><td>{nf(j.budget)}</td><td>{nf(j.spent)}</td><td className="wrap">{j.delayReason || "–"}</td></tr>)}
                </Table>
              )} />
            </Card>
            {sel && <Detail j={sel} onClose={() => setSel(null)} />}
            <EditDataHint datasets={[["pj", "Projects register"]]} />
          </>
        );
      }}
    </Screen>
  );
}
