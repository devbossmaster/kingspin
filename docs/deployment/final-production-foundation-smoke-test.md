# Final Production-Foundation Smoke Test

This checklist is for play-money closed-alpha validation only. Passing it does
not mean KingSpin / SpinPro is real-money ready.

## Safety Gates

- Production env validation fails when `DATABASE_URL`, `BETTER_AUTH_SECRET`,
  production HTTPS origins, auth email settings, or non-mock payment provider
  settings are missing.
- `ENABLE_DEV_AUTH=false` in production.
- `ENABLE_LOCAL_DEV_AUTH=false` and `ADMIN_DEV_KEY` is not configured outside
  local development.
- `ENABLE_REDIS=true` and `REDIS_URL` are set; production startup does not use
  in-memory rate limits or fraud counters.
- `ROUND_MACHINE_AUTO_START=true` on the API process that owns permanent room
  lifecycle startup.
- `GET /health/round-machine` reports enabled/running machines, Redis
  availability, and zero stale completed/current rounds.
- Admin development key routes reject outside local development.
- Normal player UI has no `playerKey`, `userId`, wallet id, role, or balance
  fields in entry requests.
- Browser bundle contains no secret-like `NEXT_PUBLIC_*SECRET*`,
  `NEXT_PUBLIC_*KEY*`, or hardcoded private keys.

## Admin And Audit

- Sign in as a normal player and open `/admin`: the page shows admin role
  required and no admin controls.
- Sign in as `ADMIN`, `OWNER`, or another permitted role and open `/admin`.
- Confirm admin API calls require Better Auth session plus RBAC role.
- Run one room mutation, one risk review, one deposit approval, and one
  withdrawal transition in staging.
- Confirm each successful admin mutation creates an `AdminAuditLog`.
- Confirm audit write failures fail closed and require manual review.

## Payments And Wallets

- Create a manual deposit, approve it once, then replay confirmation.
- Confirm wallet credit and ledger deposit transaction happen once.
- Request a withdrawal, approve it, mark paid, and replay mark paid.
- Request another withdrawal, reject it twice.
- Confirm withdrawal reserve and refund ledgers do not double mutate wallets.
- Confirm no wallet balance becomes negative.

## Game Modes

- Seed or verify these categories and permanent rooms:
  - `pro-10-100` / `PRO-A` / flexible / 10-100
  - `pro-100-200` / `PRO-B` / flexible / 100-200
  - `pro-200-350` / `PRO-C` / flexible / 200-350
  - `fixed-10` / `FIX-10` / fixed / 10
  - `fixed-20` / `FIX-20` / fixed / 20
  - `fixed-50` / `FIX-50` / fixed / 50
- Confirm each seeded room is `ACTIVE`, `isPermanent=true`, and has an active
  round or a running round machine.
- Confirm `/health/round-machine` shows each active permanent room covered by a
  running machine before game-flow testing.
- Pro 10-100 accepts 10, 50, and 100.
- Pro rejects 9 and 101.
- Pro top-up works only while the round is `OPEN`.
- Fixed 10 accepts exactly 10.
- Fixed 10 rejects 9, 11, 20, and top-up attempts.
- Locked/non-open rounds reject entry and top-up without debit or ledger drift.

## Realtime And Workers

- With production env, confirm `/health/redis` succeeds before entry testing.
- With production env, confirm `/health/round-machine` returns `status: "ok"`
  before entry testing. If it is degraded, check for stopped machines, stale
  completed rounds past cooldown, stale locked/drawing/spinning rounds, Redis
  lock contention, or tick failure logs.
- With `ENABLE_REDIS=true` and `REDIS_URL`, confirm Socket.IO adapter,
  live-state invalidation, Redis cache, and Redis lock logs show healthy
  operation.
- In local/test only, `ENABLE_REDIS=false` may be used to confirm single-instance
  REST live-state and local socket broadcasts.
- Enqueue retry jobs with stable job ids and confirm worker result logs upsert
  deterministic `result:<jobId>` records.
- Confirm worker jobs report or call idempotent services only; workers must not
  decide winners or edit wallet balances directly.

## Player Flow

- Open `/` as a guest: home is visible with Pro and Fixed cards.
- Open `/spinpro` as a guest: categories are visible.
- Click a category or Join button as a guest: browser goes to sign-in with a
  `callbackURL` back to the selected room.
- Sign in and confirm return to the selected room.
- In Pro mode, confirm chips, custom amount, and top-up UI are visible while
  `OPEN`.
- In Fixed mode, confirm no custom amount or top-up UI is visible.
- Confirm entry POST returns quickly, locally merges the entry, updates wallet
  from the response, and reconciles via socket without repeated refresh spam.
- Confirm mobile bottom navigation is visible and respects safe area.

## Required Real-Money Work Still Remaining

- Legal and compliance review.
- KYC/AML design and operations where required.
- Payment provider approval and production credentials.
- Monitoring, alerting, backups, restore testing, and incident response.
- Independent security review and penetration testing.
- Fraud operations, escalation procedures, and support tooling.
- Accounting and reconciliation review.
- Terms of service, privacy policy, and responsible gaming policy.
