-- Buildings can be renamed or archived; each change is kept with its reason.
ALTER TABLE "Property" ADD COLUMN "archivedAt" TIMESTAMP(3),
ADD COLUMN "archivedBy" TEXT NOT NULL DEFAULT '',
ADD COLUMN "archiveReason" TEXT NOT NULL DEFAULT '';

CREATE TABLE "PropertyChange" (
    "id" TEXT NOT NULL,
    "propertyId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fromName" TEXT NOT NULL DEFAULT '',
    "toName" TEXT NOT NULL DEFAULT '',
    "reason" TEXT NOT NULL,
    "byId" TEXT,
    "byName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PropertyChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PropertyChange_propertyId_createdAt_idx" ON "PropertyChange"("propertyId", "createdAt");

ALTER TABLE "PropertyChange" ADD CONSTRAINT "PropertyChange_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE;
