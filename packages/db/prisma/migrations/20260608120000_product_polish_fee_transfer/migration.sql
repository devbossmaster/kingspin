ALTER TYPE "LedgerTransactionType" ADD VALUE IF NOT EXISTS 'WALLET_TRANSFER';

ALTER TABLE "rounds"
  ADD COLUMN "platformFeeBps" INTEGER;

ALTER TABLE "rounds"
  ADD CONSTRAINT "rounds_platformFeeBps_check"
  CHECK ("platformFeeBps" IS NULL OR ("platformFeeBps" >= 0 AND "platformFeeBps" <= 10000));

DROP INDEX IF EXISTS "categories_name_key";

UPDATE "categories" SET "name" = 'Base' WHERE "slug" IN ('pro-10-100', 'fixed-10');
UPDATE "categories" SET "name" = 'Palace' WHERE "slug" IN ('pro-100-200', 'fixed-20');
UPDATE "categories" SET "name" = 'Empire' WHERE "slug" IN ('pro-200-350', 'fixed-50');

WITH ranked_rooms AS (
  SELECT
    r.id,
    mapping.prefix || LPAD(
      ROW_NUMBER() OVER (
        PARTITION BY c."slug"
        ORDER BY r."createdAt", r.id
      )::text,
      2,
      '0'
    ) AS code
  FROM "rooms" r
  JOIN "categories" c ON c.id = r."categoryId"
  JOIN (
  VALUES
      ('pro-10-100', 'FB'),
      ('pro-100-200', 'FP'),
      ('pro-200-350', 'FE'),
      ('fixed-10', 'CB'),
      ('fixed-20', 'CP'),
      ('fixed-50', 'CE')
  ) AS mapping(slug, prefix) ON mapping.slug = c."slug"
)
UPDATE "rooms" r
SET "code" = ranked_rooms.code, "name" = ranked_rooms.code
FROM ranked_rooms
WHERE r.id = ranked_rooms.id;
