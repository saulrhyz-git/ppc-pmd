// Demo accounts for the owner / tenant portal (My Portal, /myportal). Sample data only; safe to run again.
import type { PrismaClient } from "@prisma/client";

const DEMO: { email: string; name: string; building: string; relation: string; seeAll: boolean }[] = [
  { email: "tenant@example.com", name: "Acme Corp", building: "Tower A", relation: "Tenant", seeAll: false },
  { email: "owner@example.com", name: "Olivia Reyes", building: "Court D", relation: "Owner", seeAll: true },
];

export async function seedPortal(prisma: PrismaClient, passwordHash: string) {
  for (const d of DEMO) {
    const unit = await prisma.unit.findFirst({ where: { property: { name: d.building }, status: "Active", kind: { not: "Common area" } }, orderBy: { code: "asc" } });
    if (!unit) continue;
    const a = await prisma.portalAccount.upsert({
      where: { email: d.email },
      create: { email: d.email, name: d.name, passwordHash, passwordChangedAt: new Date() },
      update: {},
    });
    await prisma.portalUnitAccess.upsert({
      where: { accountId_unitId: { accountId: a.id, unitId: unit.id } },
      create: { accountId: a.id, unitId: unit.id, relation: d.relation, canRequest: true, seeAllRequests: d.seeAll, grantedByName: "Sample data" },
      update: {},
    });
    console.log(`Portal demo account ${d.email} -> ${d.building} unit ${unit.code} (${d.relation})`);
  }
}
