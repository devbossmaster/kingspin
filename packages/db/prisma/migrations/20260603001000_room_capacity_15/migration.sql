ALTER TABLE "categories" ALTER COLUMN "maxPlayers" SET DEFAULT 15;
ALTER TABLE "rooms" ALTER COLUMN "maxPlayers" SET DEFAULT 15;

UPDATE "categories"
SET "maxPlayers" = 15
WHERE "maxPlayers" IN (24, 30);

UPDATE "rooms"
SET "maxPlayers" = 15
WHERE "maxPlayers" IN (24, 30);
