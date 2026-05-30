# Production Safety Checklist

This checklist moves KingSpin / SpinPro toward a professional play-money and
money-ready architecture. It is not a real-money production certification.

## Source Of Truth

- Postgres is the source of truth for wallets, ledger transactions, entries,
  rounds, winners, deposits, withdrawals, and audit logs.
- Redis may be used for Socket.IO fanout, public live-state cache, locks,
  presence, rate limiting, and BullMQ transport only.
- BullMQ jobs must call idempotent service methods for money mutations. Jobs
  must not decide winners, edit balances directly, or bypass the ledger.
- Every money mutation must use deterministic idempotency keys.

## Required Production Environment

- `NODE_ENV=production`
- `APP_ENV=production`
- `DATABASE_URL` set to the intended production database.
- `BETTER_AUTH_SECRET` set to a strong secret.
- `BETTER_AUTH_URL` and `WEB_URL` set to public HTTPS URLs.
- `API_CORS_ORIGIN` or `CORS_ORIGIN` limited to trusted origins.
- `ENABLE_DEV_AUTH=false`
- `ROUND_MACHINE_AUTO_START=true` only on the intended machine process. On API
  boot this starts every `ACTIVE` permanent room machine; empty and single-player
  rounds are cancelled/refunded by the server lifecycle instead of drawing.
- `ENABLE_REDIS=true` before horizontal API scaling.
- `REDIS_URL` set when Redis, Socket.IO adapter, BullMQ, or multi-instance
  round-machine locking is enabled.
- `PAYMENT_PROVIDER` set to a non-mock provider only after a real provider
  adapter has passed provider approval, webhook, and reconciliation testing.

Do not commit secrets. Rotate any database password, Better Auth secret, admin
key, payment secret, or Redis secret that has been pasted into chat, logs, or a
ticket.

## Database And Prisma

- Run migrations with `pnpm migrate:deploy`.
- Do not run `prisma migrate dev` or `prisma db push` against production.
- Back up the database before the first production migration and before high
  risk schema changes.
- Deploy the API close to the Supabase/Postgres region.
- Use a direct database URL or session pooler for long-running Prisma servers
  unless the hosting platform specifically requires another mode.
- Avoid transaction poolers for Prisma server workloads that use transactions
  unless tested end to end.
- Set Prisma connection limits deliberately for API and worker instances to
  avoid connection queueing during entry bursts.

## Payment Gateway Readiness

- Keep providers behind the `PaymentGatewayProvider` interface.
- Verify deposit webhooks with provider-specific signatures.
- Confirm deposits through the wallet service only once per deposit
  idempotency key.
- Reserve, approve, pay, fail, reject, and refund withdrawals through audited
  status transitions.
- Manual or mock deposit approval is for local/dev and controlled operations
  only; do not expose public production shortcuts.
- Reconcile provider records against ledger records daily before real money is
  considered.

## Admin And Audit

- Production admin access must use Better Auth roles.
- `x-admin-dev-key` routes are local/dev emergency tools only.
- Admin mutations must write `AdminAuditLog` records.
- Direct wallet balance editing is not allowed in production.
- Finance actions should require least-privilege roles such as `OWNER`,
  `ADMIN`, or `FINANCE`.
- Risk review actions should require `OWNER`, `ADMIN`, or `RISK`.

## Realtime And Redis

- Socket.IO Redis adapter should be enabled before multiple API instances.
- Live-state cache keys must remain room-specific and short-lived.
- Invalidate room live-state after entry placement and every round transition.
- Redis locks must be room-specific and release only with matching values.
- Presence keys must be room-specific and TTL-backed.
- Redis outages must degrade realtime features safely without corrupting money
  state.

## Worker Operations

- Run the worker only with `ENABLE_REDIS=true` and `REDIS_URL`.
- Use deterministic BullMQ job IDs for retries.
- Settlement retry jobs must call existing idempotent payout logic.
- Refund retry jobs must call existing idempotent refund logic.
- Reconciliation jobs should report drift and never silently auto-correct.
- Monitor failed and dead-letter jobs from the admin dashboard.

## Smoke Checks

Run before each staging or production release:

```bash
pnpm install --frozen-lockfile
pnpm db:generate
pnpm build
pnpm --filter api test
pnpm --filter api test:e2e -- entries-concurrency.e2e-spec.ts --runInBand
pnpm --filter web check-types
pnpm --filter worker build
pnpm migrate:status
pnpm smoke:staging
```

Manual smoke checks:

- Run the final production-foundation checklist in
  `docs/deployment/final-production-foundation-smoke-test.md`.
- Sign in as a normal user.
- Enter an OPEN round and confirm wallet, entry, live-state, and ledger agree.
- Confirm locked/completed rounds reject entry without wallet debit.
- Confirm `/health/db`, `/health/redis`, and realtime health endpoints.
- Confirm admin dashboard requires an admin role.
- Confirm admin room mutation writes an audit log.
- Confirm mock/manual deposit approval is unavailable or tightly guarded in
  production.
- Confirm withdrawal rejection refunds exactly once.
- Confirm duplicate deposit webhooks do not double-credit.
- Confirm duplicate withdrawal payout callbacks do not double-pay or
  double-refund.

## Real-Money Requirements Still Remaining

- Legal and regulatory review.
- KYC/AML design and operations where applicable.
- Payment provider approval and production credentials.
- Payment webhook penetration testing.
- Fraud/risk operations and escalation procedures.
- Backup, restore, monitoring, alerting, and incident response.
- Reconciliation operations and accounting review.
- Terms of service, privacy policy, and financial disclosures.
- Responsible gaming rules where applicable.
- Independent security review and penetration testing.
