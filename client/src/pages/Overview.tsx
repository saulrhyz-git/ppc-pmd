import { useState } from "react";
import type { PropertyResult } from "@pmd/shared";
import { Card, KpiGrid, Pill, Table } from "../ui";
import { PropertySheet, Screen } from "./common";

export default function Overview() {
  const [sel, setSel] = useState<PropertyResult | null>(null);
  return (
    <Screen>
      {(props) => {
        const sections = [...new Set(props.map((p) => p.section))];
        return (
          <>
            <div style={{ textAlign: "center", fontWeight: 800, letterSpacing: ".12em", fontSize: 16, margin: "2px 0 8px" }}>PROPERTY HEALTH</div>
            <div className="secrow" style={{ ["--n" as string]: Math.min(3, sections.length) }}>
              {sections.map((s) => {
                const ps = props.filter((p) => p.section === s);
                const red = ps.reduce((a, p) => a + p.red, 0);
                return (
                  <div key={s} className="card sc" style={{ display: "block" }}>
                    <h2>{s} section <Pill level={red ? "r" : ps.some((p) => p.issues.length) ? "a" : "g"}>{red ? `${red} Red` : undefined}</Pill></h2>
                    <p className="mu">{ps.length} building{ps.length === 1 ? "" : "s"}</p>
                    {ps.map((p) => (
                      <div key={p.name} className="sb" onClick={() => setSel(p)}>
                        <div className="row"><b>{p.name}</b><span className="spacer" /><Pill level={p.red ? "r" : p.issues.length ? "a" : "g"} /></div>
                        <div className="mu">{p.red} Red · score {p.score}</div>
                        <div className="sbi">{(p.issues[0]?.text) || "No Red or Amber issues"}</div>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
            <Card title="Ranking by attention score" sub="Red and Amber points (default Red = 3, Amber = 1, Green = 0; editable per building in Settings) across all the KPI tiles. Tap a row for its KPI cards.">
              <Table head={["#", "Building", "Section", "Red", "Score", "Worst issue"]}>
                {props.map((p, i) => (
                  <tr key={p.name} className="click" onClick={() => setSel(p)}>
                    <td>{i + 1}</td><td><b>{p.name}</b></td><td>{p.section}</td><td><Pill level={p.red ? "r" : "g"}>{p.red}</Pill></td><td>{p.score}</td>
                    <td className="wrap">{(p.issues.find((x) => x.level === "r") || p.issues[0])?.text || "None"}</td>
                  </tr>
                ))}
              </Table>
            </Card>
            {props.length === 1 && <Card title={`${props[0].name} KPIs`}><KpiGrid kpis={props[0].kpis} /></Card>}
            {sel && <PropertySheet p={sel} onClose={() => setSel(null)} />}
          </>
        );
      }}
    </Screen>
  );
}
