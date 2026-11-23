// Seeds sections, buildings, demo users and sample data.
//   npm run db:seed              -> users + buildings + sample registers (only if empty)
//   SEED_SAMPLE=0 npm run db:seed -> users + buildings only (for production)
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { defaultTabs, sampleRows, SAMPLE_PROPERTIES, type Role } from "@pmd/shared";

const prisma = new PrismaClient();

async function main() {
  const password = process.env.SEED_PASSWORD || "ChangeMe123!";
  const hash = await bcrypt.hash(password, 12);
  const sections = ["Commercial", "Industrial", "Residential"];
  for (const [i, name] of sections.entries()) await prisma.section.upsert({ where: { name }, create: { name, sortOrder: i }, update: {} });
  for (const p of SAMPLE_PROPERTIES) {
    const sec = await prisma.section.findUniqueOrThrow({ where: { name: p.section } });
    await prisma.property.upsert({ where: { name: p.name }, create: { name: p.name, sectionId: sec.id }, update: {} });
  }

  const users: [string, string, Role, string | null, string[], boolean][] = [
    ["gm@example.com", "General Manager", "General Manager", null, [], true],
    ["dh@example.com", "Department Head", "Department Head", null, [], true],
    ["sup.commercial@example.com", "Supervisor Commercial", "Supervisor", "Commercial", [], true],
    ["sup.industrial@example.com", "Supervisor Industrial", "Supervisor", "Industrial", [], true],
    ["sup.residential@example.com", "Supervisor Residential", "Supervisor", "Residential", [], true],
    ["eng1@example.com", "Admin/Engineer 1", "Admin/Engineer", null, ["Tower A", "Plaza B"], false],
    ["eng2@example.com", "Admin/Engineer 2", "Admin/Engineer", null, ["Annex C"], false],
    ["eng3@example.com", "Admin/Engineer 3", "Admin/Engineer", null, ["Court D", "Hall E"], false],
    ["tenant@example.com", "Acme Corp", "Tenant", null, ["Tower A"], false],
  ];
  for (const [email, name, role, section, properties, canApprove] of users) {
    await prisma.user.upsert({ where: { email }, create: { email, name, role, section, properties, canApprove, tabs: defaultTabs(role), passwordHash: hash }, update: {} });
  }

  if (process.env.SEED_SAMPLE !== "0" && (await prisma.datasetRow.count()) === 0) {
    const asOf = new Date().toISOString().slice(0, 10);
    const rows = sampleRows(asOf);
    const dh = await prisma.user.findUniqueOrThrow({ where: { email: "dh@example.com" } });
    for (const [dataset, list] of Object.entries(rows)) {
      if (list.length) await prisma.datasetRow.createMany({ data: list.map((data) => ({ dataset, property: data.property, data, createdById: dh.id, updatedById: dh.id })) });
    }
    console.log("Sample data loaded for", asOf);
  }
  console.log(`Seed complete. Demo users sign in with password: ${process.env.SEED_PASSWORD ? "(SEED_PASSWORD)" : password}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
