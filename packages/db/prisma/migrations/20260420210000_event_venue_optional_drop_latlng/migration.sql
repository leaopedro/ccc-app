-- Make venue + location fields optional and drop lat/lng. Admin no longer
-- collects coordinates; mobile "Abrir no mapa" falls back to a text query
-- built from whatever location fields are present.
ALTER TABLE "Event" ALTER COLUMN "venueName" DROP NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "venueAddress" DROP NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "city" DROP NOT NULL;
ALTER TABLE "Event" ALTER COLUMN "stateCode" DROP NOT NULL;
ALTER TABLE "Event" DROP COLUMN "lat";
ALTER TABLE "Event" DROP COLUMN "lng";
