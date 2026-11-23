import { useState } from "react";
import type { Kpi, PropertyResult } from "@pmd/shared";
import { Card, Pill } from "../ui";
import { KpiSheet, PropertySheet, Screen } from "./common";
import { ConcernsInboxCard } from "./ConcernsInbox";

export default function NeedsFocus() {
  const [sel, setSel] = useState<PropertyResult | null>(null);
  const [kpi, setKpi] = useState<{ p: PropertyResult; k: Kpi } | null>(null);
  return (
    <Screen>
      {(props) => {
        const flagged = props.filter((p) => p.issues.length);
        return (
          <>
            <p className="mu">Tip: tap any building or issue for details.</p>
            <ConcernsInboxCard compact />
            <div style={{ textAlign: "center", fontWeight: 800, letterSpacing: ".12em", fontSize: 16, margin: "2px 0 8px" }}>PROPERTY HEALTH</div>
            <Card title="Act-first brief" sub="Buildings ranked by Red KPIs (including Safety and security), then attention score. Buildings with no Red or Amber issue are not listed. Issues are the three most severe signals per building.">
              {!flagged.length && <p className="mu">Every building is Green. Nothing needs attention.</p>}
              <div className="bgrid">
                {flagged.map((p, i) => (
                  <div key={p.name} className="sb" onClick={() => setSel(p)}>
                    <div className="row">
                      <span className="rk" style={{ position: "static" }}>{i + 1}</span>
                      <h3 className="sbh" style={{ margin: 0 }}>{p.name}</h3>
                      <span className="spacer" />
                      <Pill level={p.red ? "r" : "a"}>{p.red ? `${p.red} Red` : "Amber"}</Pill>
                    </div>
                    <div className="mu" style={{ margin: "4px 0" }}>{p.section} · score {p.score}</div>
                    <ul>
                      {p.issues.slice(0, 3).map((x) => (
                        <li key={x.key} className="sbi" onClick={(e) => { e.stopPropagation(); setKpi({ p, k: p.kpis.find((k) => k.key === x.key)! }); }}>
                          <span className={"dot " + x.level} /> {x.text}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </Card>
            {sel && <PropertySheet p={sel} onClose={() => setSel(null)} />}
            {kpi && <KpiSheet p={kpi.p} k={kpi.k} onClose={() => setKpi(null)} />}
          </>
        );
      }}
    </Screen>
  );
}
