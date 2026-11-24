-- Portal: the first meter-reading date a person may see for a unit (null = full history).
ALTER TABLE "PortalUnitAccess" ADD COLUMN "readingsFrom" DATE;
