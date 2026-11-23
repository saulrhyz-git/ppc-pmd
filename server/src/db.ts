import { PrismaClient } from "@prisma/client";
import { mergeThresholds, scopeFor, type SessionUser, type Thresholds } from "@pmd/shared";

export const prisma = new PrismaClient();

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const s = await prisma.setting.findUnique({ where: { key } });
  return (s?.value as T) ?? fallback;
}

export async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
}

export async function getThresholds(): Promise<Thresholds> {
  return mergeThresholds(await getSetting("thresholds", {}));
}

/** The as-of date dashboards are computed for. Defaults to today. */
export async function getAsOf(): Promise<string> {
  const v = await getSetting<string | null>("asOf", null);
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : new Date().toISOString().slice(0, 10);
}

export async function allProperties() {
  const ps = await prisma.property.findMany({ include: { section: true }, orderBy: [{ section: { sortOrder: "asc" } }, { name: "asc" }] });
  return ps.map((p) => ({ id: p.id, name: p.name, section: p.section?.name ?? null, scoreRed: p.scoreRed, scoreAmber: p.scoreAmber }));
}

export async function scopeOf(u: SessionUser): Promise<string[]> {
  return scopeFor(u, await allProperties());
}

export async function audit(u: SessionUser | null, action: string, detail?: unknown) {
  await prisma.auditLog.create({ data: { userId: u?.id, userName: u?.name, action, detail: (detail ?? undefined) as object | undefined } });
}
