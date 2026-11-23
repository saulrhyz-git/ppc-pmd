// Seeds sections, buildings, demo users and sample data.
//   npm run db:seed              -> users + buildings + sample registers (only if empty)
//   SEED_SAMPLE=0 npm run db:seed -> users + buildings only (for production)
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { defaultTabs, legacyRowToWo, sampleRows, SAMPLE_PROPERTIES, type Role } from "@pmd/shared";

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
    ["tech1@example.com", "Technician 1", "Technician", null, ["Tower A", "Plaza B"], false],
    ["tech2@example.com", "Technician 2", "Technician", null, ["Annex C", "Court D", "Hall E"], false],
    ["tenant@example.com", "Acme Corp", "Tenant", null, ["Tower A"], false],
  ];
  for (const [email, name, role, section, properties, canApprove] of users) {
    await prisma.user.upsert({ where: { email }, create: { email, name, role, section, properties, canApprove, tabs: defaultTabs(role), passwordHash: hash }, update: {} });
  }

  const sample = process.env.SEED_SAMPLE !== "0";
  const asOf = new Date().toISOString().slice(0, 10);
  const { m: woRows, ...rows } = sampleRows(asOf);
  const dh = await prisma.user.findUniqueOrThrow({ where: { email: "dh@example.com" } });
  if (sample && (await prisma.datasetRow.count()) === 0) {
    for (const [dataset, list] of Object.entries(rows)) {
      if (list.length) await prisma.datasetRow.createMany({ data: list.map((data) => ({ dataset, property: data.property, data, createdById: dh.id, updatedById: dh.id })) });
    }
    console.log("Sample registers loaded for", asOf);
  }
  if (sample && (await prisma.workOrder.count()) === 0) await seedWorkOrders(woRows, asOf, dh.id);
  console.log(`Seed complete. Demo users sign in with password: ${process.env.SEED_PASSWORD ? "(SEED_PASSWORD)" : password}`);
}

/** Sample work orders, with the open ones spread over the lifecycle so every status shows up. */
async function seedWorkOrders(list: Record<string, string>[], asOf: string, dhId: string) {
  const techs = await prisma.user.findMany({ where: { role: "Technician" } });
  const sups = await prisma.user.findMany({ where: { role: "Supervisor" } });
  const props = await prisma.property.findMany({ include: { section: true } });
  const secOf = Object.fromEntries(props.map((p) => [p.name, p.section?.name]));
  const flow = ["New", "Assigned", "In Progress", "On Hold", "Completed"] as const;
  let k = 0;
  for (const r of list) {
    const f = legacyRowToWo(r, asOf);
    const tech = techs.find((t) => t.properties.includes(f.property));
    const sup = sups.find((s) => s.section === secOf[f.property]);
    const open = f.status !== "Closed";
    const status = open ? flow[k++ % flow.length] : "Closed";
    const assignees = status === "New" ? [] : [tech, sup && k % 3 === 0 ? sup : undefined].filter((x) => !!x);
    const at = (d: string) => new Date(d + "T09:00:00");
    const w = await prisma.workOrder.create({
      data: {
        ...f, status, dateOpened: new Date(f.dateOpened), targetDate: new Date(f.targetDate),
        priority: k % 7 === 0 ? "Urgent" : k % 4 === 0 ? "High" : "Medium",
        startedAt: ["In Progress", "On Hold", "Completed", "Closed"].includes(status) ? at(f.dateOpened) : null,
        completedAt: status === "Completed" ? at(asOf) : f.completedAt ? at(f.completedAt) : null,
        closedAt: f.closedAt ? at(f.closedAt) : null,
        holdReason: status === "On Hold" ? "Waiting for spare part from supplier" : "",
        actionTaken: status === "Completed" && !f.actionTaken ? "Replaced worn part and tested" : f.actionTaken,
        createdById: dhId, updatedById: dhId,
        assignees: { create: assignees.map((u) => ({ userId: u!.id, assignedById: sup?.id ?? dhId })) },
      },
    });
    await prisma.workOrderEvent.create({ data: { workOrderId: w.id, kind: "created", toStatus: "New", authorId: dhId, createdAt: at(f.dateOpened) } });
    if (status !== "New" && status !== "Closed") await prisma.workOrderEvent.create({ data: { workOrderId: w.id, kind: "status", fromStatus: "New", toStatus: status, message: w.holdReason, authorId: status === "Assigned" ? sup?.id ?? dhId : assignees[0]?.id ?? dhId } });
    if (status === "Closed") await prisma.workOrderEvent.create({ data: { workOrderId: w.id, kind: "status", fromStatus: "Completed", toStatus: "Closed", authorId: sup?.id ?? dhId, createdAt: w.closedAt ?? undefined } });
  }
  console.log(`Sample work orders loaded: ${list.length}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
