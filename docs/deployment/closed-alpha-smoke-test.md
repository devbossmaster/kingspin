# Closed-Alpha Smoke Test

Use this after deploying the web and API services to Coolify/Nixpacks and after
running Prisma migrations with `migrate:deploy`. This is for play-money
closed-alpha validation only.

## 1. Confirm Environment

- API URL: `https://api.your-domain.com`
- Web URL: `https://your-domain.com`
- API health: open `https://api.your-domain.com/health`
- DB health: open `https://api.your-domain.com/health/db`
- Migration status:

```bash
pnpm --filter @kingspin/db migrate:status
```

- Redis status:
  - For Coolify/production envs, confirm `ENABLE_REDIS=true`, `REDIS_URL` is
    set, `/health/redis` succeeds, and API logs show the Socket.IO Redis adapter
    enabled.
  - `ENABLE_REDIS=false` is for local/test single-instance workflows only.

Automated smoke check:

```bash
SMOKE_API_URL=https://api.your-domain.com SMOKE_WEB_URL=https://your-domain.com pnpm smoke:staging
```

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
10. Confirm latest-result fairness proof passes.
11. Confirm payout appears for the winner.

Expected:

- Round timing, entries, ticket ranges, winner, spin angle, settlement, and
  wallet movement come from the backend.
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

## 8. Rollback Notes

- Stop the round machine from admin-only tooling if needed.
- Pause active rooms instead of deleting data.
- Inspect API and web logs in Coolify.
- Inspect DB migration status with `migrate:status`.
- Roll back the application deployment in Coolify if a release fails.
- Avoid destructive database rollback. Restore from a tested backup when a DB
  rollback is truly required.

No real-money testing, payment testing, KYC, withdrawals, or compliance workflow
is covered by this smoke test.
