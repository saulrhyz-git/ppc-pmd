import { Router } from "express";
import { z } from "zod";
import { cleanRow, compute, DATASET_BY_KEY, DATASETS, parseCsv, toCsv, validateRow, type DatasetKey, type Row } from "@pmd/shared";
import { prisma, allProperties, audit, getAsOf, getThresholds, scopeOf } from "../db.ts";
import { HttpError, requireTab, staffOnly } from "../auth.ts";

export const dataRouter = Router();
dataRouter.use(staffOnly);

const dsKey = (k: string): DatasetKey => {
  if (!(k in DATASET_BY_KEY)) throw new HttpError(404, "Unknown dataset");
  return k as DatasetKey;
};

/** Rows of every dataset for the buildings the user may see. */
async function scopedRows(scope: string[]) {
  const rows = await prisma.datasetRow.findMany({ where: { property: { in: scope } }, orderBy: { createdAt: "asc" } });
  const by: Partial<Record<DatasetKey, (Row & { _id: string })[]>> = {};
  for (const r of rows) (by[r.dataset as DatasetKey] ??= []).push({ ...(r.data as Row), property: r.property, _id: r.id });
  return by;
}

// ---------- dashboard ----------
dataRouter.get("/dashboard", async (req, res, next) => {
  try {
    const scope = await scopeOf(req.user!);
    const props = (await allProperties()).filter((p) => scope.includes(p.name));
    const [rows, thresholds, asOf] = await Promise.all([scopedRows(scope), getThresholds(), getAsOf()]);
    const weights = Object.fromEntries(props.map((p) => [p.name, { r: p.scoreRed, a: p.scoreAmber }]));
    const d = compute({ asOf, properties: props, rows, thresholds, weights });
    res.json({ ...d, thresholds });
  } catch (e) {
    next(e);
  }
});

// ---------- datasets ----------
dataRouter.get("/datasets", (_req, res) => res.json(DATASETS));

dataRouter.get("/datasets/:key/rows", requireTab("data", 1), async (req, res, next) => {
  try {
    const key = dsKey(req.params.key);
    const scope = await scopeOf(req.user!);
    const property = typeof req.query.property === "string" && req.query.property ? req.query.property : null;
    if (property && !scope.includes(property)) throw new HttpError(403, "Not your building");
    const rows = await prisma.datasetRow.findMany({ where: { dataset: key, property: property ? property : { in: scope } }, orderBy: { createdAt: "asc" } });
    res.json(rows.map((r) => ({ id: r.id, property: r.property, data: r.data, updatedAt: r.updatedAt })));
  } catch (e) {
    next(e);
  }
});

const rowBody = z.object({ data: z.record(z.unknown()) });

async function checkRow(req: Express.Request, key: DatasetKey, raw: Record<string, unknown>) {
  const data = cleanRow(key, raw);
  const err = validateRow(key, data);
  if (err) throw new HttpError(400, err);
  const scope = await scopeOf(req.user!);
  if (!scope.includes(data.property)) throw new HttpError(403, `You cannot add data for "${data.property}"`);
  return data;
}

dataRouter.post("/datasets/:key/rows", requireTab("data", 2), async (req, res, next) => {
  try {
    const key = dsKey(req.params.key);
    const data = await checkRow(req, key, rowBody.parse(req.body).data);
    const r = await prisma.datasetRow.create({ data: { dataset: key, property: data.property, data, createdById: req.user!.id, updatedById: req.user!.id } });
    await audit(req.user!, "row.create", { dataset: key, id: r.id });
    res.status(201).json({ id: r.id, property: r.property, data: r.data, updatedAt: r.updatedAt });
  } catch (e) {
    next(e);
  }
});

dataRouter.put("/datasets/:key/rows/:id", requireTab("data", 2), async (req, res, next) => {
  try {
    const key = dsKey(req.params.key);
    const old = await prisma.datasetRow.findUnique({ where: { id: req.params.id } });
    if (!old || old.dataset !== key) throw new HttpError(404, "Row not found");
    const scope = await scopeOf(req.user!);
    if (!scope.includes(old.property)) throw new HttpError(403, "Not your building");
    const data = await checkRow(req, key, rowBody.parse(req.body).data);
    const r = await prisma.datasetRow.update({ where: { id: old.id }, data: { property: data.property, data, updatedById: req.user!.id } });
    await audit(req.user!, "row.update", { dataset: key, id: r.id, before: old.data });
    res.json({ id: r.id, property: r.property, data: r.data, updatedAt: r.updatedAt });
  } catch (e) {
    next(e);
  }
});

dataRouter.delete("/datasets/:key/rows/:id", requireTab("data", 2), async (req, res, next) => {
  try {
    const key = dsKey(req.params.key);
    const old = await prisma.datasetRow.findUnique({ where: { id: req.params.id } });
    if (!old || old.dataset !== key) throw new HttpError(404, "Row not found");
    const scope = await scopeOf(req.user!);
    if (!scope.includes(old.property)) throw new HttpError(403, "Not your building");
    await prisma.datasetRow.delete({ where: { id: old.id } });
    await audit(req.user!, "row.delete", { dataset: key, id: old.id, data: old.data });
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

/** CSV import. mode=append adds rows; mode=replace replaces the rows of the buildings in the file. */
dataRouter.post("/datasets/:key/import", requireTab("data", 2), async (req, res, next) => {
  try {
    const key = dsKey(req.params.key);
    const { csv, mode } = z.object({ csv: z.string().max(10_000_000), mode: z.enum(["append", "replace"]).default("append") }).parse(req.body);
    const scope = await scopeOf(req.user!);
    const parsed = parseCsv(csv);
    const ok: Row[] = [], rejected: { line: number; message: string }[] = [];
    parsed.forEach((raw, i) => {
      const r = cleanRow(key, raw);
      const err = validateRow(key, r) ?? (!scope.includes(r.property) ? `building "${r.property}" is not one of yours (or does not exist yet)` : null);
      if (err) rejected.push({ line: i + 2, message: err });
      else ok.push(r);
    });
    await prisma.$transaction(async (tx) => {
      if (mode === "replace") {
        const ps = [...new Set(ok.map((r) => r.property))];
        await tx.datasetRow.deleteMany({ where: { dataset: key, property: { in: ps } } });
      }
      if (ok.length) await tx.datasetRow.createMany({ data: ok.map((data) => ({ dataset: key, property: data.property, data, createdById: req.user!.id, updatedById: req.user!.id })) });
    });
    await audit(req.user!, "dataset.import", { dataset: key, mode, imported: ok.length, rejected: rejected.length });
    res.json({ imported: ok.length, rejected });
  } catch (e) {
    next(e);
  }
});

dataRouter.get("/datasets/:key/export.csv", requireTab("data", 1), async (req, res, next) => {
  try {
    const key = dsKey(req.params.key);
    const scope = await scopeOf(req.user!);
    const rows = await prisma.datasetRow.findMany({ where: { dataset: key, property: { in: scope } }, orderBy: { createdAt: "asc" } });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${key}-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(toCsv(key, rows.map((r) => r.data as Row)));
  } catch (e) {
    next(e);
  }
});
