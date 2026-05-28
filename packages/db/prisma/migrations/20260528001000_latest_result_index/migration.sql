-- Latest completed result lookup: WHERE roomId = ? AND status = COMPLETED
-- ORDER BY roundNumber DESC, completedAt DESC.
CREATE INDEX "rounds_roomId_status_roundNumber_completedAt_idx" ON "rounds"("roomId", "status", "roundNumber", "completedAt");
