// Sample units, equipment, meters and ~75 days of meter readings. Fictional data, loaded only
// into an empty asset register. Includes the situations the meter checks catch: a misread lower
// than the previous reading, a meter replacement, a spike, a closed space with zero use and two
// missed days.
import type { PrismaClient } from "@prisma/client";

const DAY = 864e5;
const addDays = (d: string, n: number) => new Date(Date.parse(d + "T00:00:00Z") + n * DAY).toISOString().slice(0, 10);

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const COMMERCIAL_TENANTS = ["Harbor Coffee", "Northwind Clinic", "Bluebird Books", "Summit Bank", "Lumen Optical", "Peak Fitness", "Orchard Grocer", "Cobalt IT Services", "Juniper Salon", "Maple Bakery", "Atlas Insurance", "Vertex Dental"];
const OWNERS = ["R. Santos", "M. Reyes", "J. Cruz", "A. Bautista", "L. Garcia", "P. Mendoza", "K. Torres", "D. Flores", "E. Ramos", "S. Aquino", "T. Villanueva", "C. Navarro"];

export async function seedAssets(prisma: PrismaClient, asOf: string, techEmail = "tech1@example.com") {
  if ((await prisma.unit.count()) > 0 || (await prisma.asset.count()) > 0) return;
  const rand = rng(20261124);
  const props = await prisma.property.findMany();
  const by = (n: string) => props.find((p) => p.name === n);
  const tech = await prisma.user.findUnique({ where: { email: techEmail } });

  const setup: [string, "Commercial" | "Condominium", string, number][] = [
    ["Tower A", "Commercial", "TA", 12], ["Plaza B", "Commercial", "PB", 8], ["Court D", "Condominium", "CD", 16], ["Hall E", "Condominium", "HE", 10], ["Annex C", "Commercial", "AC", 4],
  ];
  for (const [name, kind, code, count] of setup) {
    const p = by(name);
    if (!p) continue;
    await prisma.property.update({ where: { id: p.id }, data: { kind, code, floors: kind === "Condominium" ? Math.ceil(count / 4) + 1 : 3 } });
    const units = [];
    for (let i = 0; i < count; i++) {
      const floor = kind === "Condominium" ? String(Math.floor(i / 4) + 2) : i < 6 ? "GF" : "2F";
      const ucode = kind === "Condominium" ? `${floor}-${String((i % 4) + 1).padStart(2, "0")}` : `${floor}-${String((i % 6) + 1).padStart(2, "0")}`;
      const leased = kind === "Commercial" ? i < count - 1 : i % 3 === 0;
      units.push(await prisma.unit.create({
        data: {
          propertyId: p.id, code: ucode, floor, kind: kind === "Condominium" ? "Condominium unit" : "Commercial space",
          areaSqm: Math.round((kind === "Condominium" ? 38 + rand() * 40 : 45 + rand() * 160) * 10) / 10,
          occupancy: kind === "Commercial" ? (leased ? "Leased" : "Vacant") : leased ? "Leased" : "Owner-occupied",
          ownerName: kind === "Condominium" ? OWNERS[i % OWNERS.length] : "",
          tenantName: kind === "Commercial" ? (leased ? COMMERCIAL_TENANTS[(i + code.length) % COMMERCIAL_TENANTS.length] : "") : leased ? `Lessee ${ucode}` : "",
        },
      }));
    }
    await prisma.unit.create({ data: { propertyId: p.id, code: "CA-LOBBY", kind: "Common area", floor: "GF", occupancy: "Vacant", notes: "Lobby and corridors" } });

    // Equipment
    const eq = async (tag: string, nm: string, category: string, trade: string, location: string, extra: Record<string, unknown> = {}) =>
      prisma.asset.create({ data: { tag: `${code}-${tag}`, propertyId: p.id, name: nm, category, trade, location, make: "", installDate: new Date(`20${10 + Math.floor(rand() * 12)}-0${1 + Math.floor(rand() * 9)}-15`), ...extra } });
    const ch = await eq("CH-01", "Chiller 1", "Chiller", "HVAC", "Roof deck", { critical: true, make: "Carrier", model: "30XA" });
    await eq("CH-01-CP", "Chiller 1 condenser pump", "Pump", "Plumbing", "Roof deck", { parentId: ch.id });
    await eq("LF-01", "Passenger lift 1", "Elevator / Escalator", "Electrical", "Core A", { critical: true, make: "Mitsubishi" });
    await eq("GEN-01", "Standby generator", "Generator", "Electrical", "Genset room", { critical: true, make: "Cummins" });
    await eq("FP-01", "Fire pump", "Fire protection", "Fire Protection", "Pump room", { critical: true });
    await eq("MDP-01", "Main distribution panel", "Switchgear / Panel", "Electrical", "Main electrical room", { critical: true });
    await eq("WT-01", "Domestic water tank", "Water tank", "Plumbing", "Roof deck");
    if (units[0]) await eq("FCU-" + units[0].code, `Fan coil unit, ${units[0].code}`, "AHU / FCU", "HVAC", units[0].code, { unitId: units[0].id });

    // Meters (Tower A and Court D only): one per unit, two common area, one utility main
    const withReadings = name === "Tower A" || name === "Court D";
    if (!withReadings) continue;
    const start = addDays(asOf, -75);
    const meters: { id: string; base: number; cls: string; start: number }[] = [];
    let mi = 0;
    for (const u of units) {
      mi++;
      const base = kind === "Condominium" ? 6 + rand() * 10 : 60 + rand() * 260;
      const m = await prisma.meter.create({
        data: { code: `M-${code}-${String(mi).padStart(2, "0")}`, propertyId: p.id, unitId: u.id, meterClass: "Tenant", serial: `SN-${code}-${1000 + mi * 37}`, brand: "Schneider PM2100", location: kind === "Condominium" ? `Meter bank, ${u.floor}F` : `Electrical room, ${u.floor}`, activeFrom: new Date(start), rolloverAt: 999999.9 },
      });
      meters.push({ id: m.id, base, cls: "Tenant", start: 1000 + rand() * 40000 });
    }
    for (const [i, nm] of ["Lighting and corridors", "Chiller plant and pumps"].entries()) {
      const m = await prisma.meter.create({ data: { code: `M-${code}-CA${i + 1}`, propertyId: p.id, meterClass: "Common Area", location: "Main electrical room", activeFrom: new Date(start), notes: nm, assetId: i === 1 ? ch.id : null } });
      meters.push({ id: m.id, base: kind === "Condominium" ? 120 : 380 + i * 500, cls: "Common Area", start: 20000 + rand() * 50000 });
    }
    const main = await prisma.meter.create({ data: { code: `M-${code}-MAIN`, propertyId: p.id, meterClass: "Utility Main", ctRatio: "800:5", multiplier: 160, location: "Utility metering enclosure", activeFrom: new Date(start), notes: "Utility billing meter. Register × 160 = kWh." } });

    // Daily readings up to yesterday, so today's round is still to do.
    const days = 75;
    const values: Record<string, number> = {};
    const sumByDay: number[] = new Array(days).fill(0);
    const rows: { meterId: string; readingDate: Date; readAt: Date; value: number; takenById: string | null; note?: string }[] = [];
    const events: { meterId: string; date: Date; type: string; prevReading: number; newReading: number; notes: string; byId: string | null }[] = [];
    meters.forEach((m, idx) => {
      let v = m.start;
      values[m.id] = v;
      for (let d = 0; d < days; d++) {
        const date = addDays(start, d);
        const dow = new Date(date + "T00:00:00Z").getUTCDay();
        let use = m.base * (0.85 + rand() * 0.3) * (dow === 0 && m.cls === "Tenant" && kind === "Commercial" ? 0.35 : 1);
        if (name === "Tower A" && idx === 3 && d === days - 1) use *= 3.4; // spike yesterday
        if (name === "Tower A" && idx === 5 && d >= days - 4) use = 0; // space closed, zero use
        if (d > 0) { v += use; sumByDay[d] += use; }
        const date0 = date;
        if (name === "Tower A" && idx === 7 && (d === days - 3 || d === days - 2)) continue; // two missed days
        if (name === "Tower A" && idx === 2 && d === days - 20) {
          // Meter replaced: old register ended at v, new one starts at 0.
          events.push({ meterId: m.id, date: new Date(date0), type: "Replacement", prevReading: Math.round(v * 10) / 10, newReading: 0, notes: "Display failed; replaced with a new unit.", byId: tech?.id ?? null });
          v = 0;
        }
        let shown = Math.round(v * 10) / 10;
        let note: string | undefined;
        if (name === "Tower A" && idx === 1 && d === days - 3) { shown = Math.round((v - 900) * 10) / 10; note = undefined; } // misread lower than previous
        rows.push({ meterId: m.id, readingDate: new Date(date0), readAt: new Date(`${date0}T0${7 + Math.floor(rand() * 3)}:${String(Math.floor(rand() * 60)).padStart(2, "0")}:00`), value: shown, takenById: tech?.id ?? null, note });
      }
    });
    // Utility main: the sum of sub-meters plus ~6% losses, divided by the multiplier.
    let mv = 5000;
    for (let d = 0; d < days; d++) {
      if (d > 0) mv += (sumByDay[d] * (1.05 + rand() * 0.02)) / 160;
      const date = addDays(start, d);
      rows.push({ meterId: main.id, readingDate: new Date(date), readAt: new Date(`${date}T07:05:00`), value: Math.round(mv * 100) / 100, takenById: tech?.id ?? null });
    }
    await prisma.meterReading.createMany({ data: rows.map((r) => ({ ...r, note: r.note ?? "" })) });
    if (events.length) await prisma.meterEvent.createMany({ data: events });
  }
  console.log("Sample units, equipment and meters loaded");
}
