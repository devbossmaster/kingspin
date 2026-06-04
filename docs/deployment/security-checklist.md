# Closed-Alpha Security Checklist

This checklist tracks play-money closed-alpha deployment safety. It is not a
real-money production security certification.

## Public Dev Identity Surface

Status: pass, with admin-only test tools intentionally retained.

- Public `/dev/players` routes are not registered.
- Public `POST /rooms/:roomId/entries/dev-place` is not registered.
- Normal frontend source must not reference `/dev/players`,
  `/entries/dev-place`, or `playerKey`.
- Production entry route is `POST /rooms/:roomId/entries`.
- Entry body is strict: `amount` and optional `idempotencyKey` only.
- Local-only development helpers live under `/admin/*` and require
  `x-admin-dev-key`. They are disabled unless `APP_ENV=local` and
  `NODE_ENV` is not `production`.

Verify:

```bash
pnpm security:static
pnpm --filter web test:static-safety
```

## Auth And Session Security

Status: wired for real Better Auth validation, requires deployed cookie/domain
testing.

- Better Auth lives in `apps/web`.
- API AuthBridge validates the incoming session by calling
  `BETTER_AUTH_URL/api/auth/get-session`.
- `BETTER_AUTH_SECRET` is required in production for API and web.
- `BETTER_AUTH_URL` must be the deployed web origin.
- `ENABLE_DEV_AUTH=false` is required in production.
- `ENABLE_LOCAL_DEV_AUTH=false` is required outside local development.
- `x-dev-user-id` is rejected outside true local development and is
  database-validated when enabled locally.
- Protected API routes reject unauthenticated requests.
- Better Auth requires email verification before email/password auth flow is
  considered ready for room entry.

If web and API use separate subdomains, configure:

```bash
BETTER_AUTH_COOKIE_DOMAIN=.your-domain.com
```

## Cookie, CORS, And Origins

Status: pass for single trusted web origin.

- API CORS uses validated `API_CORS_ORIGIN`.
- API CORS credentials are enabled only for the configured web origin.
- Socket.IO CORS uses the same configured origin policy.
- Frontend protected fetches use `credentials: "include"`.
- Cookie-authenticated REST mutations use a double-submit CSRF cookie plus
  `x-csrf-token`; read-only GETs and Socket.IO are unaffected.
- Frontend clients fetch `GET /csrf` with credentials before mutating
  cookie-auth REST requests.
- Production URLs must use HTTPS public domains.
- `NEXT_PUBLIC_SOCKET_URL` should point at the public Socket.IO namespace, for
  example `https://api.your-domain.com/game`.

## Secret Hygiene

Status: pass for repo content; final values belong only in Coolify envs.

- No real secrets should be committed.
- Real `.env` files are ignored and kept per app/package.
- `apps/web/.env.local` is not used; use `apps/web/.env`.
- `.env.example` files use placeholders only.
- No secrets belong in `NEXT_PUBLIC_*` variables.
- No admin key, API key, database password, or Better Auth secret is hardcoded in
  source.

Verify:

```bash
git ls-files | grep -E '(^|/)\.env(\.|$)' || true
pnpm security:static
```

Only `.env.example` files should appear in tracked files.

## Admin Gates

Status: pass for local-only development tooling.

- Admin routes use `AdminDevGuard`.
- Missing `ADMIN_DEV_KEY` rejects access.
- Wrong `x-admin-dev-key` rejects access.
- Normal player UI does not use admin routes.
- Do not configure `ADMIN_DEV_KEY` in staging, preview, or production.
- Never expose `x-admin-dev-key` routes publicly.
- Rotate `ADMIN_DEV_KEY` immediately if it is pasted into chat, logs, or a
  ticket.

Future improvement: replace admin dev key tooling with real admin auth and audit
review workflows.

## Rate Limiting And Abuse Checks

Status: basic protection in place.

- API has a global rate-limit guard backed by Redis outside local/test.
- Production env validation requires `ENABLE_REDIS=true` and `REDIS_URL`; there
  is no in-memory rate-limit fallback outside local/test.
- Entry route is covered by API rate limiting.
- Public live-state/latest-result endpoints are covered by API rate limiting.
- Rapid-entry fraud protection uses Redis and fails closed if Redis is
  unavailable in production.
- Better Auth and Resend provide baseline auth email abuse controls.

Limitations:

- Fraud operations workflow and support tooling remain TODO.

## Headers And Error Handling

Status: pass for basic closed-alpha headers/errors.

- API global exception filter hides stack traces in production.
- API initializes Sentry error capture when `SENTRY_DSN` is configured.
- Sentry request context filters cookies, auth tokens, sessions, wallet,
  payment, and private fields.
- API responses include request IDs where available.
- API request logging interceptor records method, path, status, and duration.
- Web response headers include:
  - `X-Frame-Options`
  - `X-Content-Type-Options`
  - `Referrer-Policy`
  - `Permissions-Policy`
  - `Content-Security-Policy` with `frame-ancestors`

Future improvement: full CSP tuned for scripts/connect/img/font sources after
final CDN/domain decisions.

## Database And Migration Safety

Status: pass for deployment readiness.

- Staging/production docs use `pnpm --filter @kingspin/db migrate:deploy`.
- Staging/production docs forbid `prisma migrate dev`.
- Staging/production docs forbid `prisma db push`.
- Migration status command is documented.
- Backup/restore warning is documented before first staging/production
  migration.
- Production API errors hide internal Prisma details.

## Socket Security

Status: pass for authenticated room/category joins, with deployed
cookie/domain testing still required.

- Socket.IO CORS matches the configured web origin.
- `room:join` and `category:join` require Better Auth session validation before
  live state is returned.
- Authenticated socket user IDs are stored on socket state for subsequent room
  events.
- Room existence is validated before joining room-specific broadcasts.
- Entry placement still requires authenticated REST API requests.
- Reconnect handling refreshes room state.

Future improvement: move session validation to the initial Socket.IO handshake
if private rooms, user-specific socket events, or moderation actions move onto
sockets.

## Static Checks

Run before deployment:

```bash
pnpm security:static
pnpm --filter web test:static-safety
rg -n "/dev/players|entries/dev-place|playerKey" apps/web
rg -n "origin:\s*true|origin:\s*['\"]\*" apps/api/src
rg -n "NEXT_PUBLIC_.*(SECRET|KEY|TOKEN)" apps web packages
```

Expected:

- Web source has no public dev identity flow.
- API production CORS is not wildcard.
- Secrets are not in public env vars.

## Remaining Gaps Before Real Production

- Payments are not implemented.
- KYC/legal/compliance are not implemented.
- Withdrawals are not implemented.
- Fraud operations are TODO.
- Reconciliation is skeleton-level.
- Admin review workflow needs real admin auth.
- Redis Socket.IO adapter and `/health/redis` need live deployment testing.
- OpenTelemetry needs real integration if tracing is required.
- Backup/restore and incident response plans need operational ownership.
