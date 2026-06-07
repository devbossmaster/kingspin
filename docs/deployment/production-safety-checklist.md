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
- `ENABLE_LOCAL_DEV_AUTH=false`
- Do not set `ADMIN_DEV_KEY` outside local development. Static dev-key routes
  are local-only and are not production admin access.
- `TRUST_PROXY_HEADERS=true` only when the API is behind trusted
  Coolify/Nginx/proxy infrastructure that controls forwarded client IP headers.
- `ROUND_MACHINE_AUTO_START=true` only on the intended machine process. On API
  boot this starts every `ACTIVE` permanent room machine; empty and single-player
  rounds are cancelled/refunded by the server lifecycle instead of drawing.
- Confirm `GET /health/round-machine` reports `roundMachine.enabled=true`,
  running permanent room machines, Redis availability, and zero stale
  completed/current rounds before opening traffic.
- `ENABLE_REDIS=true` and `REDIS_URL` set. Production API startup must not fall
  back to in-memory rate limiting or fraud counters.
- If Telebirr receipt deposits are enabled, set
  `TELEBIRR_RECEIPT_VERIFICATION_ENABLED=true`,
  `TELEBIRR_RECEIPT_BASE_URL=https://transactioninfo.ethiotelecom.et/receipt`,
  sane min/max/TTL/HTTP limits, and at least one receiver identity:
  `TELEBIRR_EXPECTED_RECEIVER_NAME`, `TELEBIRR_EXPECTED_RECEIVER_ACCOUNT`, or
  `TELEBIRR_EXPECTED_SHORT_CODE`.
- Browser clients fetch `GET /csrf` with credentials before mutating
  cookie-auth REST requests and send the returned value as `x-csrf-token`.
- `SENTRY_DSN` is optional, but recommended for production error visibility.
- `PAYMENT_PROVIDER` set to a non-mock provider only after a real provider
  adapter has passed provider approval, webhook, and reconciliation testing.

Do not commit secrets. Rotate any database password, Better Auth secret,
local admin dev key, payment secret, or Redis secret that has been pasted into
chat, logs, or a ticket.

## Database And Prisma

- Run migrations with `pnpm --filter @kingspin/db migrate:deploy`.
- Check status before and after with
  `pnpm --filter @kingspin/db migrate:status`.
- Do not run `prisma migrate reset`, `prisma migrate dev`, or `prisma db push`
  against production.
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
- Telebirr receipt deposits are a fallback flow: the backend must fetch the
  official receipt page and verify amount, receiver, currency, receipt id,
  status, and time window before wallet credit.
- Confirm deposits through the wallet service only once per deposit
  idempotency key.
- Reserve, approve, pay, fail, reject, and refund withdrawals through audited
  status transitions.
- Withdrawals are manual in this phase. Admins may complete a withdrawal only
  after an external payout reference exists; the app must not auto-send
  Telebirr money.
- Manual or mock deposit approval is for local/dev and controlled operations
  only; do not expose public production shortcuts.
- Reconcile provider records against ledger records daily before real money is
  considered.

## Admin And Audit

- Production admin access must use Better Auth roles.
- `x-admin-dev-key` routes are local development tools only; do not configure
  `ADMIN_DEV_KEY` in staging, preview, or production.
- Admin mutations must write `AdminAuditLog` records.
- Direct wallet balance editing is not allowed in production.
- Finance actions should require least-privilege roles such as `OWNER`,
  `ADMIN`, or `FINANCE`.
- Risk review actions should require `OWNER`, `ADMIN`, or `RISK`.

## Fraud And Privacy

- Fraud signals are advisory review events only. They must not change winner
  selection, ticket math, payout logic, ledger invariants, or withdrawal payout
  automation.
- Store hashed IP/user-agent/device-like correlation data only. Do not store raw
  IP addresses, raw user agents, cookies, auth headers, or raw Telebirr receipt
  HTML in risk metadata.
- Risk fingerprints should use a server-side HMAC secret such as
  `BETTER_AUTH_SECRET` or `CSRF_SECRET`; never expose the salt/secret in admin
  APIs or frontend bundles.
- Device correlation must remain conservative and first-party. Avoid invasive
  browser fingerprinting signals unless legal/privacy review approves them.
- Admin risk reviews should record notes and audit logs, but automatic bans,
  fund seizure, or payout reversal require an explicit, separately approved
  admin action.

## Realtime And Redis

- Production API requires Redis; confirm `/health/redis` before entry testing.
- Confirm `/health/round-machine` before entry testing. Treat
  `status: "degraded"`, `staleCompletedOrCurrent > 0`, or active permanent
  rooms with `runningPermanent=0` as a release blocker.
- Socket.IO Redis adapter should be healthy before multiple API instances.
- Live-state cache keys must remain room-specific and short-lived.
- Invalidate room live-state after entry placement and every round transition.
- Redis locks must be room-specific and release only with matching values.
- Presence keys must be room-specific and TTL-backed.
- Redis outages must fail closed for sensitive rate-limit, fraud, and locking
  paths without corrupting money state.
- Round machine warning logs should be monitored:
  `[round-machine-stuck:*]`, `[round-machine-skip:*]`, and
  `[round-machine-tick-failed:*]`.

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
pnpm --filter @kingspin/db migrate:status
pnpm smoke:staging
```

Manual smoke checks:

- Run the final production-foundation checklist in
  `docs/deployment/final-production-foundation-smoke-test.md`.
- Sign in as a normal user.
- Enter an OPEN round and confirm wallet, entry, live-state, and ledger agree.
- Confirm locked/completed rounds reject entry without wallet debit.
- Confirm `/health/db`, `/health/redis`, `/health/realtime`, and
  `/health/round-machine` endpoints.
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
