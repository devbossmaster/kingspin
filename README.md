You are Codex working inside my KingSpin / SpinPro monorepo.

TASK:
Add BullMQ background worker architecture for production-scale reliability without changing the server-authoritative game rules.

Context:
- Backend already has ledger-first wallet, idempotent entry holds/refunds/payouts, round machine, advisory locks, health/logging/rate limits.
- Redis may already be configured through ENABLE_REDIS and REDIS_URL.
- This project uses NestJS API and Turborepo.
- Do not make BullMQ the source of truth for winner selection.
- Do not remove existing idempotency.
- Do not add public dev endpoints.
- Do not claim real-money readiness.

Goal:
Create a safe BullMQ worker foundation for retryable background jobs:
- reconciliation
- failed settlement retry
- failed refund retry
- fraud checks
- admin/audit exports
- optional notification jobs

Requirements:
1. Create worker structure, preferably:
   - apps/worker
   or a NestJS worker module if current repo structure prefers it.
2. Add shared queue names/types:
   - packages/queues or packages/contracts if appropriate.
3. Redis config:
   - require REDIS_URL when worker is enabled.
   - fail fast in production if worker enabled but Redis missing.
4. Add queues:
   - reconciliationQueue
   - settlementRetryQueue
   - refundRetryQueue
   - fraudCheckQueue
   - notificationQueue if useful
5. Job rules:
   - every job has deterministic jobId/idempotency key.
   - every job is safe to retry.
   - every wallet mutation still uses existing idempotent wallet service methods.
   - no double payout.
   - no double refund.
6. API integration:
   - API may enqueue retry jobs after safe failure.
   - API must not enqueue duplicate jobs for same logical operation.
7. Worker safety:
   - concurrency limits.
   - exponential backoff.
   - max attempts.
   - dead-letter/failed job logging.
   - graceful shutdown.
8. Observability:
   - log job start/success/failure.
   - health endpoint or worker heartbeat if practical.
9. Tests:
   - settlement retry job does not double payout.
   - refund retry job does not double refund.
   - reconciliation reports drift but does not auto-correct silently.
10. Validation:
   - pnpm --filter worker build if worker app exists
   - pnpm --filter api build
   - pnpm build
   - relevant tests

Final report:
- queues added
- jobs added
- Redis env required
- retry/idempotency strategy
- what remains before real-money production

