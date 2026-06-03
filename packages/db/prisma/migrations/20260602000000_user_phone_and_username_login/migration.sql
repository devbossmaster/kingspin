ALTER TABLE "users" ADD COLUMN "displayUsername" TEXT;
ALTER TABLE "users" ADD COLUMN "phoneNumber" TEXT;

UPDATE "users"
SET "phoneNumber" = '+251900' || lpad(numbered.rn::text, 6, '0')
FROM (
  SELECT "id", row_number() OVER (ORDER BY "createdAt", "id") AS rn
  FROM "users"
) AS numbered
WHERE "users"."id" = numbered."id" AND "users"."phoneNumber" IS NULL;

ALTER TABLE "users" ALTER COLUMN "phoneNumber" SET NOT NULL;

CREATE UNIQUE INDEX "users_phoneNumber_key" ON "users"("phoneNumber");
