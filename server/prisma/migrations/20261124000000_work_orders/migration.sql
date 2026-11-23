-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "ticket" TEXT NOT NULL,
    "property" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "activityType" TEXT NOT NULL DEFAULT 'Reactive',
    "trade" TEXT NOT NULL DEFAULT '',
    "priority" TEXT NOT NULL DEFAULT 'Medium',
    "status" TEXT NOT NULL DEFAULT 'New',
    "location" TEXT NOT NULL DEFAULT '',
    "asset" TEXT NOT NULL DEFAULT '',
    "reportedBy" TEXT NOT NULL DEFAULT '',
    "tenant" TEXT NOT NULL DEFAULT '',
    "rootCause" TEXT NOT NULL DEFAULT '',
    "remarks" TEXT NOT NULL DEFAULT '',
    "estCost" DECIMAL(14,2),
    "chargeable" BOOLEAN NOT NULL DEFAULT false,
    "dateOpened" DATE NOT NULL,
    "targetDate" DATE NOT NULL,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "holdReason" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL DEFAULT '',
    "actionTaken" TEXT NOT NULL DEFAULT '',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "concernId" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "legacyData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrderAssignee" (
    "workOrderId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderAssignee_pkey" PRIMARY KEY ("workOrderId","userId")
);

-- CreateTable
CREATE TABLE "WorkOrderEvent" (
    "id" TEXT NOT NULL,
    "workOrderId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromStatus" TEXT,
    "toStatus" TEXT,
    "message" TEXT NOT NULL DEFAULT '',
    "detail" JSONB,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_ticket_key" ON "WorkOrder"("ticket");

-- CreateIndex
CREATE INDEX "WorkOrder_property_status_idx" ON "WorkOrder"("property", "status");

-- CreateIndex
CREATE INDEX "WorkOrder_status_idx" ON "WorkOrder"("status");

-- CreateIndex
CREATE INDEX "WorkOrderAssignee_userId_idx" ON "WorkOrderAssignee"("userId");

-- CreateIndex
CREATE INDEX "WorkOrderEvent_workOrderId_createdAt_idx" ON "WorkOrderEvent"("workOrderId", "createdAt");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_concernId_fkey" FOREIGN KEY ("concernId") REFERENCES "Concern"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAssignee" ADD CONSTRAINT "WorkOrderAssignee_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAssignee" ADD CONSTRAINT "WorkOrderAssignee_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderAssignee" ADD CONSTRAINT "WorkOrderAssignee_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderEvent" ADD CONSTRAINT "WorkOrderEvent_workOrderId_fkey" FOREIGN KEY ("workOrderId") REFERENCES "WorkOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrderEvent" ADD CONSTRAINT "WorkOrderEvent_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Ticket numbers for new work orders (WO-<year>-<number>).
CREATE SEQUENCE "WorkOrder_ticket_seq" START 1;

-- ---------------------------------------------------------------------------
-- Move the rows of the old "m" register (work orders master log) into WorkOrder.
-- Each work order keeps the register row's id, and the original row is kept in
-- "legacyData", so nothing is lost. Open rows become "New" (nobody assigned yet;
-- the old free-text owner is kept in "ownerName"); closed rows become "Closed".
-- ---------------------------------------------------------------------------
CREATE FUNCTION pg_temp.wo_date(v TEXT, fallback DATE) RETURNS DATE AS $$
BEGIN
  IF v IS NULL OR v !~ '^\d{4}-\d{2}-\d{2}' THEN RETURN fallback; END IF;
  RETURN substr(v, 1, 10)::DATE;
EXCEPTION WHEN others THEN RETURN fallback;
END $$ LANGUAGE plpgsql;

CREATE FUNCTION pg_temp.wo_num(v TEXT) RETURNS DECIMAL(14,2) AS $$
BEGIN
  IF v IS NULL OR btrim(v) = '' THEN RETURN NULL; END IF;
  RETURN replace(btrim(v), ',', '')::DECIMAL(14,2);
EXCEPTION WHEN others THEN RETURN NULL;
END $$ LANGUAGE plpgsql;

WITH src AS (
  SELECT r.*,
         COALESCE(NULLIF(btrim(r.data->>'ticket'), ''), 'WO-OLD-' || substr(r.id, 1, 8)) AS t,
         ROW_NUMBER() OVER (PARTITION BY COALESCE(NULLIF(btrim(r.data->>'ticket'), ''), r.id) ORDER BY r."createdAt", r.id) AS rn,
         lower(btrim(COALESCE(r.data->>'status', ''))) = 'closed' AS is_closed
  FROM "DatasetRow" r
  WHERE r.dataset = 'm'
)
INSERT INTO "WorkOrder" (
  "id", "ticket", "property", "title", "description", "activityType", "status",
  "location", "asset", "reportedBy", "tenant", "rootCause", "remarks", "estCost", "chargeable",
  "dateOpened", "targetDate", "completedAt", "closedAt", "reason", "actionTaken", "ownerName",
  "createdById", "updatedById", "legacyData", "createdAt", "updatedAt"
)
SELECT
  s.id,
  CASE WHEN s.rn > 1 THEN s.t || '-' || s.rn ELSE s.t END,
  s.property,
  COALESCE(NULLIF(left(btrim(s.data->>'description'), 120), ''), NULLIF(btrim(s.data->>'asset'), '') || ' work order', 'Work order'),
  COALESCE(s.data->>'description', ''),
  CASE WHEN s.data->>'activity_type' IN ('Reactive', 'Preventive', 'Requests/Improvement') THEN s.data->>'activity_type' ELSE 'Reactive' END,
  CASE WHEN s.is_closed THEN 'Closed' ELSE 'New' END,
  COALESCE(s.data->>'location', ''),
  COALESCE(s.data->>'asset', ''),
  COALESCE(s.data->>'reported_by', ''),
  COALESCE(s.data->>'tenant', ''),
  COALESCE(s.data->>'root_cause', ''),
  concat_ws(E'\n', NULLIF(s.data->>'remarks', ''), NULLIF(s.data->>'last_update', '')),
  pg_temp.wo_num(s.data->>'est_cost'),
  COALESCE(s.data->>'chargeable_to_tenant', '') ~* '^y',
  pg_temp.wo_date(s.data->>'date_opened', s."createdAt"::DATE),
  pg_temp.wo_date(s.data->>'target_date', pg_temp.wo_date(s.data->>'date_opened', s."createdAt"::DATE)),
  CASE WHEN s.is_closed THEN pg_temp.wo_date(s.data->>'date_closed', s."updatedAt"::DATE)::TIMESTAMP END,
  CASE WHEN s.is_closed THEN pg_temp.wo_date(s.data->>'date_closed', s."updatedAt"::DATE)::TIMESTAMP END,
  COALESCE(s.data->>'reason', ''),
  COALESCE(s.data->>'action_taken', ''),
  COALESCE(s.data->>'owner', ''),
  (SELECT u.id FROM "User" u WHERE u.id = s."createdById"),
  (SELECT u.id FROM "User" u WHERE u.id = s."updatedById"),
  s.data,
  s."createdAt",
  s."updatedAt"
FROM src s;

INSERT INTO "WorkOrderEvent" ("id", "workOrderId", "kind", "toStatus", "message", "authorId", "createdAt")
SELECT 'mig_' || w.id, w.id, 'created', w.status, 'Moved from the work orders register', w."createdById", w."createdAt"
FROM "WorkOrder" w WHERE w."legacyData" IS NOT NULL;

-- Link work orders to the tenant concern whose concern slip names the ticket.
UPDATE "WorkOrder" w SET "concernId" = c.id
FROM "Concern" c JOIN "DatasetRow" s ON s.id = c."slipRowId"
WHERE btrim(s.data->>'work_order') = w.ticket AND w.property = c.property AND w."concernId" IS NULL;

-- Files attached to a register row now belong to the work order (same id).
UPDATE "Attachment" SET "ownerType" = 'workorder'
WHERE "ownerType" = 'row' AND "ownerId" IN (SELECT id FROM "WorkOrder");

DELETE FROM "DatasetRow" WHERE dataset = 'm';
