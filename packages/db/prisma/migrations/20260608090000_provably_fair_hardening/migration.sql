ALTER TABLE "rounds"
ADD COLUMN "fairnessAlgorithm" TEXT,
ADD COLUMN "entriesHash" TEXT,
ADD COLUMN "drawHash" TEXT,
ADD COLUMN "drawNonce" INTEGER;
