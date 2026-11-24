// Meters, readings and meter events, plus the checks board (exceptions, consumption, energy balance).
import { Router, type Request } from "express";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import {
  MD, METER_CLASSES, METER_EVENT_TYPES, METER_UTILITIES, READING_METHODS, REGISTER_EVENTS, UTILITY_UNIT,
  completeness, energyBalance, isMeterManager, mergeMeterThresholds, runMeters, useBetween,
  type EngineEvent, type EngineMeter, type EngineReading, type MeterDTO, type MeterEventDTO, type MeterReadingDTO, type MeterThresholds,
} from "@pmd/shared";
import { prisma, audit, getSetting, setSetting } from "../db.ts";
import { HttpError, requireTab, staffOnly } from "../auth.ts";
import { checkProperty, scopedProperties } from "./assets.ts";

export const metersRouter = Router();
metersRouter.use(staffOnly, requireTab("mtr", 1));
const canWrite = requireTab("mtr", 2);

const day = (d: Date) => d.toISOString().slice(0, 10);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-01-31");
const today = () => {
  // The building's local date (server time zone), not UTC.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const managerOnly = (req: Request) => {
  if (!isMeterManager(req.user!.role)) throw new HttpError(403, "Only supervisors and engineers can do this");
};
export const getMeterThresholds = async (): Promise<MeterThresholds> => mergeMeterThresholds(await getSetting("meterThresholds", {}));

const meterInclude = { property: { select: { name: true } }, unit: { select: { code: true, tenantName: true, ownerName: true } } };
type MeterRow = Prisma.MeterGetPayload<{ include: typeof meterInclude }>;
const meterDTO = (m: MeterRow): MeterDTO => ({
  id: m.id, code: m.code, propertyId: m.propertyId, property: m.property.name, unitId: m.unitId, unitCode: m.unit?.code ?? null,
  occupant: m.unit ? m.unit.tenantName || m.unit.ownerName : "", assetId: m.assetId,
  meterClass: m.meterClass as MeterDTO["meterClass"], utility: m.utility as MeterDTO["utility"], unitOfMeasure: m.unitOfMeasure, serial: m.serial, brand: m.brand,
  location: m.location, ctRatio: m.ctRatio, multiplier: Number(m.multiplier), rolloverAt: m.rolloverAt == null ? null : Number(m.rolloverAt),
  expectedDaily: m.expectedDaily, activeFrom: day(m.activeFrom), activeTo: m.activeTo ? day(m.activeTo) : null, notes: m.notes,
});
const engineMeter = (m: MeterDTO): EngineMeter => ({
  id: m.id, code: m.code, meterClass: m.meterClass, multiplier: m.multiplier, rolloverAt: m.rolloverAt, expectedDaily: m.expectedDaily, activeFrom: m.activeFrom, activeTo: m.activeTo, propertyId: m.propertyId,
});

const readingInclude = { takenBy: { select: { name: true } }, voidedBy: { select: { name: true } } };
type ReadingRow = Prisma.MeterReadingGetPayload<{ include: typeof readingInclude }>;
const readingDTO = (r: ReadingRow): MeterReadingDTO => ({
  id: r.id, meterId: r.meterId, date: day(r.readingDate), readAt: r.readAt.toISOString(), value: Number(r.value), method: r.method, note: r.note,
  takenBy: r.takenBy?.name ?? null, voided: !!r.voidedAt, voidReason: r.voidReason, voidedBy: r.voidedBy?.name ?? null, createdAt: r.createdAt.toISOString(),
});
const eventDTO = (e: Prisma.MeterEventGetPayload<{ include: { by: { select: { name: true } } } }>): MeterEventDTO => ({
  id: e.id, meterId: e.meterId, date: day(e.date), type: e.type as MeterEventDTO["type"], prevReading: e.prevReading == null ? null : Number(e.prevReading),
  newReading: e.newReading == null ? null : Number(e.newReading), notes: e.notes, by: e.by?.name ?? null,
});

async function loadMeter(req: Request, id: string) {
  const m = await prisma.meter.findUnique({ where: { id }, include: meterInclude });
  if (!m) throw new HttpError(404, "Meter not found");
  await checkProperty(req, m.propertyId);
  return m;
}

async function engineData(meterIds: string[], from: string, to: string) {
  const [readings, events] = await Promise.all([
    prisma.meterReading.findMany({ where: { meterId: { in: meterIds }, voidedAt: null, readingDate: { gte: new Date(from), lte: new Date(to) } }, select: { id: true, meterId: true, readingDate: true, value: true } }),
    prisma.meterEvent.findMany({ where: { meterId: { in: meterIds }, date: { gte: new Date(from), lte: new Date(to) } } }),
  ]);
  return {
    readings: readings.map((r): EngineReading => ({ id: r.id, meterId: r.meterId, date: day(r.readingDate), value: Number(r.value) })),
    events: events.map((e): EngineEvent => ({ meterId: e.meterId, date: day(e.date), type: e.type, prevReading: e.prevReading == null ? null : Number(e.prevReading), newReading: e.newReading == null ? null : Number(e.newReading) })),
  };
}

// ---------- board: the daily round sheet, exceptions and monthly summary for one building ----------
metersRouter.get("/board", async (req, res, next) => {
  try {
    const q = z.object({ property: z.string().min(1, "Pick a building"), date: date.optional() }).parse(req.query);
    const props = await scopedProperties(req);
    const p = props.find((x) => x.id === q.property || x.name === q.property);
    if (!p) throw new HttpError(403, "Not your building");
    const asOf = q.date ?? today();
    const th = await getMeterThresholds();
    const month = asOf.slice(0, 7), prevMonth = MD.prevMonth(month);
    const [ms] = MD.monthRange(month);
    const [ps, pe] = MD.monthRange(prevMonth);
    const meters = (await prisma.meter.findMany({ where: { propertyId: p.id }, include: meterInclude, orderBy: { code: "asc" } })).map(meterDTO);
    const histFrom = MD.add(ps, -(th.baselineDays + 5));
    const { readings, events } = await engineData(meters.map((m) => m.id), histFrom, asOf);
    const em = meters.map(engineMeter);
    // While today's round is still open, today's unread meters are "to do", not missing.
    const isToday = asOf === today();
    const run = runMeters(em, readings, events, { from: ps, to: asOf, missingThrough: isToday ? MD.add(asOf, -1) : asOf }, th);
    const onDay = new Map(readings.filter((r) => r.date === asOf).map((r) => [r.meterId, r]));
    const rows = meters.map((m, i) => {
      const r = run.meters[m.id];
      const active = m.activeFrom <= asOf && (!m.activeTo || m.activeTo >= asOf);
      const monthUse = useBetween(r, ms, asOf);
      const prevUse = useBetween(r, ps, pe).use;
      // Same number of days last month, for a fair month-to-date comparison.
      const pmToDate = useBetween(r, ps, MD.add(ps, MD.diff(ms, asOf))).use;
      const prior = readings.filter((x) => x.meterId === m.id && x.date < asOf).sort((a, b) => b.date.localeCompare(a.date))[0] ?? null;
      return {
        ...m, active,
        reading: onDay.get(m.id) ?? null,
        previous: prior ? { date: prior.date, value: prior.value } : null,
        baselinePerDay: r.baselinePerDay,
        monthToDate: monthUse.use, estimatedDays: monthUse.estimatedDays,
        prevMonth: prevUse,
        momPct: pmToDate > 0 ? Math.round(((monthUse.use - pmToDate) / pmToDate) * 1000) / 10 : null,
        completeness: isToday && asOf === ms ? null : completeness(em[i], readings, ms, isToday ? MD.add(asOf, -1) : asOf),
        missingStreak: r.missing[asOf] ?? r.missing[MD.add(asOf, -1)] ?? 0,
      };
    });
    const monthExceptions = run.exceptions.filter((x) => x.date >= ms);
    const expectedToday = rows.filter((r) => r.active && r.expectedDaily);
    res.json({
      property: { id: p.id, name: p.name }, date: asOf, month, prevMonth,
      meters: rows,
      exceptions: monthExceptions,
      balance: energyBalance(em, run, ms, asOf, th)[0] ?? null,
      prevBalance: energyBalance(em, run, ps, pe, th)[0] ?? null,
      kpis: {
        expected: expectedToday.length,
        read: expectedToday.filter((r) => r.reading).length,
        critical: monthExceptions.filter((x) => x.severity === "Critical").length,
        high: monthExceptions.filter((x) => x.severity === "High").length,
        warning: monthExceptions.filter((x) => x.severity === "Warning").length,
      },
      thresholds: th,
    });
  } catch (e) {
    next(e);
  }
});

// ---------- meter list ----------
metersRouter.get("/", async (req, res, next) => {
  try {
    const props = await scopedProperties(req);
    const q = typeof req.query.property === "string" ? req.query.property : "";
    const ids = q ? props.filter((p) => p.id === q || p.name === q).map((p) => p.id) : props.map((p) => p.id);
    if (q && !ids.length) throw new HttpError(403, "Not your building");
    const list = await prisma.meter.findMany({ where: { propertyId: { in: ids } }, include: meterInclude, orderBy: [{ property: { name: "asc" } }, { code: "asc" }] });
    res.json(list.map(meterDTO));
  } catch (e) {
    next(e);
  }
});

metersRouter.get("/settings", async (_req, res, next) => {
  try {
    res.json(await getMeterThresholds());
  } catch (e) {
    next(e);
  }
});

metersRouter.put("/settings", canWrite, async (req, res, next) => {
  try {
    if (!["Department Head", "Supervisor"].includes(req.user!.role)) throw new HttpError(403, "Only the Department Head or a Supervisor can change meter thresholds");
    const n = z.number().nonnegative();
    const b = z.object({
      baselineDays: n.int().min(7).max(120), minBaselineDays: n.int().min(3).max(60), reliableBaselineDays: n.int().min(3).max(120),
      normalLo: n.max(1), normalHi: n.min(1).max(10), redLo: n.max(1), redHi: n.min(1).max(20), veryLow: n.max(1),
      lossGreen: n.max(100), lossAmber: n.max(100), completenessAmber: n.max(100),
    }).parse(req.body);
    if (!(b.redLo <= b.normalLo && b.normalHi <= b.redHi && b.veryLow <= b.redLo)) throw new HttpError(400, "Limits must be in order: very low ≤ red low ≤ normal low ≤ 1 ≤ normal high ≤ red high");
    if (b.lossGreen > b.lossAmber) throw new HttpError(400, "The green loss limit must not be above the amber limit");
    await setSetting("meterThresholds", b);
    await audit(req.user!, "meter.thresholds", b);
    res.json(b);
  } catch (e) {
    next(e);
  }
});

const meterFields = {
  code: z.string().trim().min(1, "Give the meter an ID, e.g. M-I3-01").max(40),
  unitId: z.string().nullable(),
  assetId: z.string().nullable(),
  meterClass: z.enum(METER_CLASSES),
  utility: z.enum(METER_UTILITIES),
  unitOfMeasure: z.string().trim().min(1).max(10),
  serial: z.string().trim().max(100),
  brand: z.string().trim().max(100),
  location: z.string().trim().max(200),
  ctRatio: z.string().trim().max(30),
  multiplier: z.number().positive().max(1e6),
  rolloverAt: z.number().positive().nullable(),
  expectedDaily: z.boolean(),
  activeFrom: date,
  activeTo: date.nullable(),
  notes: z.string().max(4000),
};
const meterCreate = z.object(meterFields).partial().extend({ propertyId: z.string().min(1), code: meterFields.code, activeFrom: meterFields.activeFrom });

async function checkMeterLinks(propertyId: string, b: { unitId?: string | null; assetId?: string | null; meterClass?: string }) {
  if (b.unitId) {
    const u = await prisma.unit.findUnique({ where: { id: b.unitId } });
    if (!u || u.propertyId !== propertyId) throw new HttpError(400, "That unit is not in this building");
  }
  if (b.assetId) {
    const a = await prisma.asset.findUnique({ where: { id: b.assetId } });
    if (!a || a.propertyId !== propertyId) throw new HttpError(400, "That asset is not in this building");
  }
}
const meterData = (b: Record<string, unknown>) => {
  const d: Record<string, unknown> = { ...b };
  if (typeof d.activeFrom === "string") d.activeFrom = new Date(d.activeFrom);
  if ("activeTo" in d) d.activeTo = d.activeTo ? new Date(d.activeTo as string) : null;
  return d;
};

metersRouter.post("/", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const b = meterCreate.parse(req.body);
    await checkProperty(req, b.propertyId);
    await checkMeterLinks(b.propertyId, b);
    if (b.activeTo && b.activeTo < b.activeFrom) throw new HttpError(400, "Active to is before Active from");
    if (await prisma.meter.findUnique({ where: { code: b.code } })) throw new HttpError(409, `Meter ${b.code} already exists`);
    const data = meterData({ ...b, unitOfMeasure: b.unitOfMeasure ?? UTILITY_UNIT[b.utility ?? "Power"] });
    const m = await prisma.meter.create({ data: data as Prisma.MeterUncheckedCreateInput });
    await audit(req.user!, "meter.create", { id: m.id, code: m.code });
    res.status(201).json(meterDTO(await loadMeter(req, m.id)));
  } catch (e) {
    next(e);
  }
});

metersRouter.patch("/:id", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const m = await loadMeter(req, req.params.id);
    const b = z.object(meterFields).partial().strict().parse(req.body);
    await checkMeterLinks(m.propertyId, b);
    const from = b.activeFrom ?? day(m.activeFrom), to = b.activeTo === undefined ? (m.activeTo ? day(m.activeTo) : null) : b.activeTo;
    if (to && to < from) throw new HttpError(400, "Active to is before Active from");
    if (b.code && b.code !== m.code && (await prisma.meter.findUnique({ where: { code: b.code } }))) throw new HttpError(409, `Meter ${b.code} already exists`);
    await prisma.meter.update({ where: { id: m.id }, data: meterData(b) as Prisma.MeterUncheckedUpdateInput });
    await audit(req.user!, "meter.update", { id: m.id, fields: Object.keys(b) });
    res.json(meterDTO(await loadMeter(req, m.id)));
  } catch (e) {
    next(e);
  }
});

// ---------- one meter: history ----------
metersRouter.get("/:id", async (req, res, next) => {
  try {
    const m = meterDTO(await loadMeter(req, req.params.id));
    const days = Math.min(400, Math.max(7, Number(req.query.days) || 90));
    const to = today(), from = MD.add(to, -days);
    const th = await getMeterThresholds();
    const [readings, events] = await Promise.all([
      prisma.meterReading.findMany({ where: { meterId: m.id, readingDate: { gte: new Date(from) } }, include: readingInclude, orderBy: [{ readingDate: "desc" }, { createdAt: "desc" }] }),
      prisma.meterEvent.findMany({ where: { meterId: m.id }, include: { by: { select: { name: true } } }, orderBy: { date: "desc" } }),
    ]);
    const data = await engineData([m.id], MD.add(from, -(th.baselineDays + 5)), to);
    const run = runMeters([engineMeter(m)], data.readings, data.events, { from, to, missingThrough: MD.add(to, -1) }, th);
    res.json({
      meter: m,
      readings: readings.map(readingDTO),
      events: events.map(eventDTO),
      intervals: run.meters[m.id].intervals.filter((iv) => iv.date >= from),
      exceptions: run.exceptions,
      baselinePerDay: run.meters[m.id].baselinePerDay,
    });
  } catch (e) {
    next(e);
  }
});

// ---------- readings ----------
metersRouter.post("/readings", canWrite, async (req, res, next) => {
  try {
    const u = req.user!;
    const b = z.object({
      meterId: z.string().min(1), date, value: z.number().nonnegative("A reading cannot be negative").max(1e12),
      method: z.enum(READING_METHODS).default("Manual"), note: z.string().trim().max(1000).default(""), replace: z.boolean().default(false),
    }).parse(req.body);
    const m = await loadMeter(req, b.meterId);
    if (b.date > today()) throw new HttpError(400, "The reading date is in the future");
    if (b.date < day(m.activeFrom) || (m.activeTo && b.date > day(m.activeTo))) throw new HttpError(400, `${m.code} is not active on ${b.date}`);
    const existing = await prisma.meterReading.findFirst({ where: { meterId: m.id, readingDate: new Date(b.date), voidedAt: null }, include: readingInclude });
    if (existing && !b.replace) {
      throw new HttpError(409, `${m.code} already has a reading of ${Number(existing.value)} for ${b.date} by ${existing.takenBy?.name ?? "someone"}. Replace it only if that reading is wrong.`);
    }
    if (existing && !isMeterManager(u.role) && existing.takenById !== u.id) throw new HttpError(403, "Only a supervisor or engineer can replace someone else's reading");
    const created = await prisma.$transaction(async (tx) => {
      if (existing) await tx.meterReading.update({ where: { id: existing.id }, data: { voidedAt: new Date(), voidedById: u.id, voidReason: b.note ? `Replaced: ${b.note}` : "Replaced by a new reading" } });
      return tx.meterReading.create({ data: { meterId: m.id, readingDate: new Date(b.date), readAt: new Date(), value: b.value, method: b.method, note: b.note, takenById: u.id }, include: readingInclude });
    });
    await audit(u, existing ? "meter.reading.replace" : "meter.reading", { meterId: m.id, code: m.code, date: b.date, value: b.value, replaced: existing?.id });
    // Immediate check against the previous reading so the technician can re-read on the spot.
    const prev = await prisma.meterReading.findFirst({ where: { meterId: m.id, voidedAt: null, readingDate: { lt: new Date(b.date) } }, orderBy: { readingDate: "desc" } });
    let warning: string | null = null;
    if (prev && b.value < Number(prev.value)) {
      const ev = await prisma.meterEvent.count({ where: { meterId: m.id, type: { in: [...REGISTER_EVENTS] }, date: { gt: prev.readingDate, lte: new Date(b.date) } } });
      if (!ev) warning = `This is lower than the previous reading (${Number(prev.value)} on ${day(prev.readingDate)}). Please re-read the meter. If it was replaced or rolled over, tell the engineer.`;
    }
    res.status(201).json({ reading: readingDTO(created), warning });
  } catch (e) {
    next(e);
  }
});

metersRouter.post("/readings/:id/void", canWrite, async (req, res, next) => {
  try {
    const u = req.user!;
    const { reason } = z.object({ reason: z.string().trim().min(3, "Say why the reading is wrong").max(1000) }).parse(req.body);
    const r = await prisma.meterReading.findUnique({ where: { id: req.params.id } });
    if (!r) throw new HttpError(404, "Reading not found");
    await loadMeter(req, r.meterId);
    if (r.voidedAt) throw new HttpError(400, "This reading is already voided");
    const own = r.takenById === u.id && Date.now() - r.createdAt.getTime() < 24 * 3600e3;
    if (!isMeterManager(u.role) && !own) throw new HttpError(403, "Only a supervisor or engineer can void this reading");
    await prisma.meterReading.update({ where: { id: r.id }, data: { voidedAt: new Date(), voidedById: u.id, voidReason: reason } });
    await audit(u, "meter.reading.void", { id: r.id, meterId: r.meterId, reason });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- meter events ----------
metersRouter.post("/:id/events", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const m = await loadMeter(req, req.params.id);
    const b = z.object({
      date, type: z.enum(METER_EVENT_TYPES), prevReading: z.number().nonnegative().nullable().default(null), newReading: z.number().nonnegative().nullable().default(null),
      notes: z.string().trim().max(2000).default(""),
    }).parse(req.body);
    if (REGISTER_EVENTS.includes(b.type) && (b.prevReading == null || b.newReading == null)) {
      throw new HttpError(400, `A ${b.type.toLowerCase()} needs the old register's final reading and the new register's starting reading`);
    }
    if (b.date > today()) throw new HttpError(400, "The event date is in the future");
    const e = await prisma.meterEvent.create({ data: { meterId: m.id, date: new Date(b.date), type: b.type, prevReading: b.prevReading, newReading: b.newReading, notes: b.notes, byId: req.user!.id }, include: { by: { select: { name: true } } } });
    await audit(req.user!, "meter.event", { meterId: m.id, code: m.code, type: b.type, date: b.date });
    res.status(201).json(eventDTO(e));
  } catch (e) {
    next(e);
  }
});

metersRouter.delete("/events/:id", canWrite, async (req, res, next) => {
  try {
    managerOnly(req);
    const e = await prisma.meterEvent.findUnique({ where: { id: req.params.id } });
    if (!e) throw new HttpError(404, "Event not found");
    await loadMeter(req, e.meterId);
    await prisma.meterEvent.delete({ where: { id: e.id } });
    await audit(req.user!, "meter.event.delete", { id: e.id, meterId: e.meterId, type: e.type, date: day(e.date) });
    res.json({ ok: true });
  } catch (err) {
    next(err);
  }
});
