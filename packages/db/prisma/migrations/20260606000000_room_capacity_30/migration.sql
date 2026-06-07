ALTER TABLE "categories" ALTER COLUMN "maxPlayers" SET DEFAULT 30;
ALTER TABLE "rooms" ALTER COLUMN "maxPlayers" SET DEFAULT 30;

UPDATE "categories"
SET "maxPlayers" = 30;

UPDATE "rooms"
SET "maxPlayers" = 30;
