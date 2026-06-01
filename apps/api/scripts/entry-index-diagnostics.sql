-- Entry hot-path diagnostics.
-- Fill the values in the params CTE, then run with psql against the same
-- DATABASE_URL used by the API. These plans should use the schema indexes
-- around rooms, rounds, wallet_accounts, entries, and ledger_transactions.

WITH params AS (
  SELECT
    'ROOM_ID_HERE'::text AS room_id,
    'USER_ID_HERE'::text AS user_id,
    'IDEMPOTENCY_KEY_HERE'::text AS idempotency_key,
    now()::timestamp AS request_accepted_at
)
SELECT 'params ready' AS diagnostic;

EXPLAIN (ANALYZE, BUFFERS)
WITH params AS (
  SELECT
    'ROOM_ID_HERE'::text AS room_id,
    now()::timestamp AS request_accepted_at
)
SELECT r.*
FROM rounds r
JOIN params p ON r."roomId" = p.room_id
WHERE r.status = CAST('OPEN' AS "RoundStatus")
  AND (r."locksAt" IS NULL OR r."locksAt" > p.request_accepted_at)
ORDER BY r."roundNumber" DESC
LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS)
WITH params AS (
  SELECT
    'ROUND_ID_HERE'::text AS round_id,
    'USER_ID_HERE'::text AS user_id
)
SELECT e.*
FROM entries e
JOIN params p ON e."roundId" = p.round_id AND e."userId" = p.user_id
LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS)
WITH params AS (
  SELECT 'USER_ID_HERE'::text AS user_id
)
SELECT w.*
FROM wallet_accounts w
JOIN params p ON w."userId" = p.user_id
WHERE w.type = CAST('MAIN' AS "WalletAccountType")
LIMIT 1;

EXPLAIN (ANALYZE, BUFFERS)
WITH params AS (
  SELECT 'IDEMPOTENCY_KEY_HERE'::text AS idempotency_key
)
SELECT lt.*
FROM ledger_transactions lt
JOIN params p ON lt."idempotencyKey" = p.idempotency_key
LIMIT 1;

SELECT
  COALESCE(state, 'unknown') AS state,
  COALESCE(wait_event_type, 'none') AS wait_event_type,
  COALESCE(wait_event, 'none') AS wait_event,
  COUNT(*)::int AS connection_count
FROM pg_stat_activity
WHERE datname = current_database()
GROUP BY 1, 2, 3
ORDER BY COUNT(*) DESC;
