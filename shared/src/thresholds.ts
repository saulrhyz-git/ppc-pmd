// Red / Amber thresholds. Defaults match the prototype and can be changed in Settings.
export interface Thresholds {
  m1: { r: number; a: number }; // concerns agreed leadtime compliance %, lower is worse
  up: { r: number; a: number }; // critical system uptime %
  m4: { r: number; a: number }; // breakdown occurrences on one asset in 90 days
  m5: { r: number; a: number }; // recurring tickets per asset+category
  m6: { r: number; a: number }; // PM compliance %
  m7: { a: number }; // permit expiry warning days
  m11: { r: number; a: number }; // budget utilisation % YTD, higher is worse
  s1: { r: number; a: number }; // monthly incident reduction %
  pj: { r: number; a: number }; // project points behind plan
  rs: { a: number }; // routine concern resolution hours
  mt: { r: number; a: number }; // MTTR hours
  rw: { r: number; a: number }; // reactive share %
  cr: { r: number; a: number }; // routine concerns resolved within rs hours %
  cx: { r: number; a: number }; // concern response minutes
  ox: { r: number; a: number }; // opex variance %
  ct: { a: number }; // contract expiry warning days
}

export const DEFAULT_THRESHOLDS: Thresholds = {
  m1: { r: 75, a: 90 },
  up: { r: 99, a: 99.5 },
  m4: { r: 3, a: 2 },
  m5: { r: 3, a: 2 },
  m6: { r: 85, a: 95 },
  m7: { a: 60 },
  m11: { r: 100, a: 90 },
  s1: { r: 0, a: 25 },
  pj: { r: 15, a: 5 },
  rs: { a: 24 },
  mt: { r: 6, a: 4 },
  rw: { r: 30, a: 20 },
  cr: { r: 70, a: 85 },
  cx: { r: 15, a: 5 },
  ox: { r: 20, a: 10 },
  ct: { a: 60 },
};

export const THRESHOLD_LABELS: Record<keyof Thresholds, string> = {
  m1: "Concerns agreed leadtime compliance (%)",
  up: "Critical system uptime (%)",
  m4: "Breakdowns on one asset in 90 days",
  m5: "Open tickets on one asset (recurring)",
  m6: "PM compliance (%)",
  m7: "Permit expiry warning (days)",
  m11: "Budget utilisation YTD (%)",
  s1: "Monthly incident reduction (%)",
  pj: "Project points behind plan",
  rs: "Routine concern resolution (hours)",
  mt: "Mean time to restore (hours)",
  rw: "Reactive work order share (%)",
  cr: "Routine concerns resolved in time (%)",
  cx: "Concern response time (minutes)",
  ox: "Operating expense variance (%)",
  ct: "Contract expiry warning (days)",
};

export function mergeThresholds(saved: unknown): Thresholds {
  const out = structuredClone(DEFAULT_THRESHOLDS) as unknown as Record<string, Record<string, number>>;
  if (saved && typeof saved === "object") {
    for (const [k, v] of Object.entries(saved as Record<string, Record<string, unknown>>)) {
      if (!(k in out) || !v || typeof v !== "object") continue;
      for (const [kk, vv] of Object.entries(v)) if (kk in out[k] && typeof vv === "number" && isFinite(vv)) out[k][kk] = vv;
    }
  }
  return out as unknown as Thresholds;
}
