-- AlterTable
ALTER TABLE "Property" ADD COLUMN     "address" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "code" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "floors" INTEGER,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'Commercial',
ADD COLUMN     "notes" TEXT NOT NULL DEFAULT '';

-- AlterTable
ALTER TABLE "WorkOrder" ADD COLUMN     "assetId" TEXT,
ADD COLUMN     "unitId" TEXT;

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'Commercial space',
    "floor" TEXT NOT NULL DEFAULT '',
    "areaSqm" DECIMAL(10,2),
    "occupancy" TEXT NOT NULL DEFAULT 'Vacant',
    "ownerName" TEXT NOT NULL DEFAULT '',
    "tenantName" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'Active',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Asset" (
    "id" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "parentId" TEXT,
    "name" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT '',
    "trade" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "make" TEXT NOT NULL DEFAULT '',
    "model" TEXT NOT NULL DEFAULT '',
    "serial" TEXT NOT NULL DEFAULT '',
    "installDate" DATE,
    "warrantyUntil" DATE,
    "critical" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'In service',
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Asset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meter" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "unitId" TEXT,
    "assetId" TEXT,
    "meterClass" TEXT NOT NULL DEFAULT 'Tenant',
    "utility" TEXT NOT NULL DEFAULT 'Power',
    "unitOfMeasure" TEXT NOT NULL DEFAULT 'kWh',
    "serial" TEXT NOT NULL DEFAULT '',
    "brand" TEXT NOT NULL DEFAULT '',
    "location" TEXT NOT NULL DEFAULT '',
    "ctRatio" TEXT NOT NULL DEFAULT '',
    "multiplier" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "rolloverAt" DECIMAL(14,2),
    "expectedDaily" BOOLEAN NOT NULL DEFAULT true,
    "activeFrom" DATE NOT NULL,
    "activeTo" DATE,
    "notes" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "readingDate" DATE NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'Manual',
    "note" TEXT NOT NULL DEFAULT '',
    "takenById" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterEvent" (
    "id" TEXT NOT NULL,
    "meterId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL,
    "prevReading" DECIMAL(14,2),
    "newReading" DECIMAL(14,2),
    "notes" TEXT NOT NULL DEFAULT '',
    "byId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Unit_propertyId_code_key" ON "Unit"("propertyId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Asset_tag_key" ON "Asset"("tag");

-- CreateIndex
CREATE INDEX "Asset_propertyId_idx" ON "Asset"("propertyId");

-- CreateIndex
CREATE INDEX "Asset_unitId_idx" ON "Asset"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Meter_code_key" ON "Meter"("code");

-- CreateIndex
CREATE INDEX "Meter_propertyId_idx" ON "Meter"("propertyId");

-- CreateIndex
CREATE INDEX "Meter_unitId_idx" ON "Meter"("unitId");

-- CreateIndex
CREATE INDEX "MeterReading_meterId_readingDate_idx" ON "MeterReading"("meterId", "readingDate");

-- CreateIndex
CREATE INDEX "MeterEvent_meterId_date_idx" ON "MeterEvent"("meterId", "date");

-- CreateIndex
CREATE INDEX "WorkOrder_unitId_idx" ON "WorkOrder"("unitId");

-- CreateIndex
CREATE INDEX "WorkOrder_assetId_idx" ON "WorkOrder"("assetId");

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Asset" ADD CONSTRAINT "Asset_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Meter" ADD CONSTRAINT "Meter_assetId_fkey" FOREIGN KEY ("assetId") REFERENCES "Asset"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_takenById_fkey" FOREIGN KEY ("takenById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_voidedById_fkey" FOREIGN KEY ("voidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterEvent" ADD CONSTRAINT "MeterEvent_meterId_fkey" FOREIGN KEY ("meterId") REFERENCES "Meter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterEvent" ADD CONSTRAINT "MeterEvent_byId_fkey" FOREIGN KEY ("byId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- One active (not voided) reading per meter per day.
CREATE UNIQUE INDEX "MeterReading_active_one_per_day" ON "MeterReading"("meterId", "readingDate") WHERE "voidedAt" IS NULL;

-- Carry the old free-text asset register ("ar" rows) over into Asset records.
INSERT INTO "Asset" ("id", "tag", "propertyId", "name", "category", "location", "critical", "status", "notes", "createdAt", "updatedAt")
SELECT
  r."id",
  CASE WHEN COALESCE(TRIM(r."data"->>'asset_tag'), '') <> ''
        AND COUNT(*) OVER (PARTITION BY UPPER(TRIM(r."data"->>'asset_tag'))) = 1
       THEN TRIM(r."data"->>'asset_tag')
       ELSE 'AR-' || UPPER(RIGHT(r."id", 8)) END,
  p."id",
  COALESCE(NULLIF(TRIM(r."data"->>'asset'), ''), 'Unnamed asset'),
  COALESCE(r."data"->>'category', ''),
  COALESCE(r."data"->>'location', ''),
  LOWER(COALESCE(r."data"->>'critical', '')) IN ('yes', 'y', 'true', '1'),
  CASE WHEN LOWER(COALESCE(r."data"->>'status', '')) IN ('down', 'out of service', 'breakdown') THEN 'Down'
       WHEN LOWER(COALESCE(r."data"->>'status', '')) IN ('retired', 'disposed', 'decommissioned') THEN 'Retired'
       WHEN LOWER(COALESCE(r."data"->>'status', '')) = 'standby' THEN 'Standby'
       ELSE 'In service' END,
  'Imported from the asset register',
  r."createdAt", CURRENT_TIMESTAMP
FROM "DatasetRow" r
JOIN "Property" p ON p."name" = r."property"
WHERE r."dataset" = 'ar';

-- Link existing work orders whose free-text asset matches exactly one asset tag or name in the same building.
UPDATE "WorkOrder" w SET "assetId" = m."assetId"
FROM (
  SELECT w2."id" AS "woId", MIN(a."id") AS "assetId"
  FROM "WorkOrder" w2
  JOIN "Property" p ON p."name" = w2."property"
  JOIN "Asset" a ON a."propertyId" = p."id" AND (LOWER(a."tag") = LOWER(TRIM(w2."asset")) OR LOWER(a."name") = LOWER(TRIM(w2."asset")))
  WHERE TRIM(w2."asset") <> ''
  GROUP BY w2."id"
  HAVING COUNT(DISTINCT a."id") = 1
) m
WHERE w."id" = m."woId";
