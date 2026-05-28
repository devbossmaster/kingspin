-- Current round lookup: WHERE roomId = ? AND status = ? ORDER BY roundNumber DESC
DROP INDEX IF EXISTS "rounds_roomId_status_idx";
CREATE INDEX "rounds_roomId_status_roundNumber_idx" ON "rounds"("roomId", "status", "roundNumber");

-- Live-state and latest-result entry lists: WHERE roundId = ? ORDER BY createdAt, id
DROP INDEX IF EXISTS "entries_roundId_idx";
CREATE INDEX "entries_roundId_createdAt_id_idx" ON "entries"("roundId", "createdAt", "id");
