# Closed-Alpha Smoke Test

Use this after deploying the web and API services to Coolify/Nixpacks and after
running Prisma migrations with `pnpm --filter @kingspin/db migrate:deploy`.
This is for play-money closed-alpha validation only.

## 1. Confirm Environment

- API URL: `https://api.your-domain.com`
- Web URL: `https://your-domain.com`
- API health: open `https://api.your-domain.com/health`
- DB health: open `https://api.your-domain.com/health/db`
- Redis health: open `https://api.your-domain.com/health/redis`
- Round machine health: open
  `https://api.your-domain.com/health/round-machine`
- Migration status before and after deploy:

```bash
pnpm --filter @kingspin/db migrate:status
pnpm --filter @kingspin/db migrate:deploy
pnpm --filter @kingspin/db migrate:status
```

- Never use `prisma migrate reset`, `prisma migrate dev`, or `prisma db push`
  against staging/production.
- Confirm the database target before migration and back it up if it contains
  real data.
- Production/staging env:
  - `NODE_ENV=production`
  - `APP_ENV=production`
  - `ENABLE_REDIS=true`
  - `REDIS_URL` and `DATABASE_URL` set
  - `BETTER_AUTH_SECRET` set and shared by web/API
  - `BETTER_AUTH_URL`, `WEB_URL`, and public API/socket URLs use HTTPS/WSS
  - `API_CORS_ORIGIN` or `CORS_ORIGIN` is the deployed web origin
  - `PAYMENT_PROVIDER` is `MANUAL` or another configured non-mock provider
  - `ENABLE_DEV_AUTH=false`
  - `ENABLE_LOCAL_DEV_AUTH=false`
  - `ADMIN_DEV_KEY` is absent
  - `TRUST_PROXY_HEADERS=true` only behind trusted Coolify/Nginx/proxy headers
  - `SENTRY_DSN` configured if production error visibility is desired
- Telebirr env if receipt deposits are enabled:
  - `TELEBIRR_RECEIPT_VERIFICATION_ENABLED=true`
  - `TELEBIRR_RECEIPT_BASE_URL=https://transactioninfo.ethiotelecom.et/receipt`
  - At least one receiver identity field is set:
    `TELEBIRR_EXPECTED_RECEIVER_NAME`,
    `TELEBIRR_EXPECTED_RECEIVER_ACCOUNT`, or
    `TELEBIRR_EXPECTED_SHORT_CODE`
  - Min/max deposit, intent TTL, HTTP timeout, and max HTML byte limits are set
- Redis status:
  - For Coolify/production envs, confirm `ENABLE_REDIS=true`, `REDIS_URL` is
    set, `/health/redis` succeeds, and API logs show the Socket.IO Redis adapter
    enabled.
  - `ENABLE_REDIS=false` is for local/test single-instance workflows only.
- Round machine status:
  - Confirm `roundMachine.enabled=true`.
  - Confirm active permanent rooms have running machines.
  - Confirm `roundMachine.staleRounds.staleCompletedOrCurrent=0`.
  - If stale counts are non-zero, inspect API logs for
    `[round-machine-stuck:*]`, `[round-machine-skip:*]`, or
    `[round-machine-tick-failed:*]` before continuing.

Automated smoke check:

```bash
SMOKE_API_URL=https://api.your-domain.com SMOKE_WEB_URL=https://your-domain.com pnpm smoke:staging
```

Service/process log checks:

- API starts without env validation errors.
- Web starts and serves `/`.
- Redis logs show connection from the API.
- Round-machine logs show active permanent rooms started.
- No dev-auth or `AdminDevGuard` production enablement warnings appear.
- Sentry initializes only when `SENTRY_DSN` is configured.

## 2. Auth

1. Open the web app.
2. Sign up with a closed-alpha test email.
3. Confirm the verification email arrives from Resend.
4. Verify the email.
5. Sign in.
6. Confirm `GET /me` succeeds in the browser session.
7. Confirm `GET /me/wallet` succeeds and returns the current user's wallet only.

Expected:

- Verification/reset links use the deployed web domain.
- Protected API calls send cookies with `credentials: "include"`.
- If web and API are separate subdomains, `BETTER_AUTH_COOKIE_DOMAIN` is set to
  the shared parent domain, for example `.your-domain.com`.

## 3. Wallet Setup

1. Create or seed a test user wallet through a safe one-off process.
2. Credit the test wallet through role-protected admin tooling or a safe
   one-off process.
3. Verify the balance with `GET /me/wallet`.

Expected:

- `x-admin-dev-key` wallet helpers are local development only and are not
  configured in Coolify/staging/production.
- Missing or wrong admin key is rejected.
- Normal player UI does not ask for `playerKey`, `userId`, or `walletId`.

## 4. Game Flow

1. Open `/spinpro`.
2. Select a category.
3. Join a room.
4. Place an entry through the frontend.
5. Confirm the API call is `POST /rooms/:roomId/entries`.
6. Confirm wallet balance debits after entry.
7. Watch Socket.IO updates arrive:
   - `round:state`
   - `round:updated`
   - `round:locked`
   - `round:spinning`
   - `round:settled`
8. Wait for round lock/draw/spin/settle.
9. Confirm winner reveal displays.
10. Wait for the reveal cooldown to end.
11. Confirm the room automatically switches to a fresh backend `OPEN` round.
12. Place an entry in the new round.
13. Confirm latest-result fairness proof passes.
14. Confirm payout appears for the winner.

Expected:

- Round timing, entries, ticket ranges, winner, spin angle, settlement, and
  wallet movement come from the backend.
- The next round is opened by the backend room machine, not by frontend fake
  state.
- Socket reconnect refreshes live room state.

## 5. Idempotency

Use API tooling or tests where practical:

1. Retry the same entry idempotency key.
2. Confirm no double debit.
3. Retry settle if admin tooling allows.
4. Confirm no double payout.
5. Confirm cancelled rounds refund holds idempotently.

## 6. Failure Checks

Run these checks before inviting users:

- Anonymous `POST /rooms/:roomId/entries` returns 401.
- Body fields `userId`, `playerKey`, or `walletId` are rejected or ignored by
  the production entry route.
- `POST /rooms/:roomId/entries/dev-place` returns 404 or 410.
- `GET /dev/players/:playerKey/balance` returns 404 or 410.
- Wrong `x-admin-dev-key` is rejected.
- `ENABLE_DEV_AUTH=false` in production.
- `ENABLE_LOCAL_DEV_AUTH=false` and `ADMIN_DEV_KEY` is not configured outside
  local development.
- API CORS allows only the deployed web origin.
- Frontend entry POSTs fetch `/csrf` with credentials and send `x-csrf-token`;
  cross-site ambient-cookie POSTs are rejected.
- Browser session cookies work over HTTPS.

## 7. Security Checks

```bash
pnpm security:static
pnpm --filter web test:static-safety
```

Confirm:

- No frontend public dev route usage.
- No `playerKey` input in player UI.
- No hardcoded secrets.
- No wildcard CORS.
- `.env` files are not tracked.

## 8. Admin Panel Smoke

Sign in as an admin role and verify `/admin` is usable with deployed data:

- Dashboard cards load game, payment, user, risk, system health, and recent
  activity metrics.
- Rooms, Players, Entries, Rounds, Deposits, Withdrawals, Risk, Audit, Health,
  and Settings pages load.
- Pagination, search/filter controls, and detail drawers work where present.
- Raw receipt HTML is not displayed.
- Private phone/email fields are masked where the admin UI expects masking.
- Unrevealed server seeds stay hidden.
- Raw Prisma errors are not shown to operators.

Safe test mutations:

- Pause and reactivate a test room.
- Suspend and restore a test user.
- Approve or reject a `NEEDS_MANUAL_REVIEW` Telebirr fixture/test deposit.
- Complete a withdrawal only after recording an external payout reference.
- Reject a withdrawal with a reason.
- Review or dismiss a risk event.
- Confirm each admin mutation creates an audit log entry.

Expected:

- Unauthenticated `/admin` shows the auth gate.
- Non-admin users cannot access admin pages or admin APIs.
- Admin APIs return 401/403 for unauthenticated/non-admin sessions.
- Admin APIs work for admin sessions with CSRF on mutating cookie-auth calls.

## 9. Payment Smoke

Use tiny internal test amounts only, or fixture/mock mode if real Telebirr
testing is not approved.

Deposit checks:

- Create a Telebirr receipt deposit intent.
- Confirm instructions display the configured receiver identity.
- Submit a receipt URL, receipt id, or 127 SMS text.
- Confirm the backend extracts only the receipt id.
- If real testing is enabled, confirm the backend fetches the official Telebirr
  receipt page.
- Confirm amount, receiver, currency, status, receipt id, and time window are
  validated server-side.
- Ambiguous fetch/parse results move to `NEEDS_MANUAL_REVIEW`.
- Verified deposits credit the wallet once through the ledger.
- Duplicate/replayed receipts cannot double-credit.
- Admin manual approval and rejection work for safe test deposits.
- Audit and risk records appear for the expected actions.

Withdrawal checks:

- User creates a withdrawal request.
- Admin sees it as pending.
- Admin completes it only after manual external payout and records the payout
  reference.
- Admin rejects another request with a reason.
- No automatic Telebirr payout occurs in this phase.

Expected:

- No frontend-trusted wallet crediting.
- Ledger idempotency is preserved.
- Manual withdrawals remain controllable and audited.

## 10. Rollback Notes

- Stop the round machine from admin-only tooling if needed.
- Pause active rooms instead of deleting data.
- Inspect API and web logs in Coolify.
- Inspect DB migration status with `migrate:status`.
- Roll back the application deployment in Coolify if a release fails.
- Avoid destructive database rollback. Restore from a tested backup when a DB
  rollback is truly required.

This checklist is not real-money launch approval. Legal/compliance review,
provider approval, KYC/AML where required, monitoring, backups, reconciliation,
support operations, terms/privacy, and an independent security review are still
required before any public real-money launch.
