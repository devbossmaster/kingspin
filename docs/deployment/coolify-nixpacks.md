# SpinPro Closed-Alpha Deployment: Coolify + Nixpacks

This guide prepares a safe staging or closed-alpha play-money deployment. It is
not a real-money production checklist.

## Services

Create two Coolify applications from the same repository using Nixpacks.
No Dockerfile, Compose file, or custom image is required for the current repo.

### API Service

- Root directory: repository root
- Build pack: Nixpacks
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm --filter @kingspin/db db:generate && pnpm --filter api build`
- Start command: `pnpm --filter api start:prod`
- Port: `4000`
- Health check path: `/health`

If your Coolify UI has a single build command field instead of separate install
and build commands, use:

```bash
pnpm install --frozen-lockfile && pnpm --filter @kingspin/db db:generate && pnpm --filter api build
```

Required API environment variables:

```bash
NODE_ENV=production
APP_ENV=production
PORT=4000
DATABASE_URL=postgresql://USER:PASSWORD@HOST:6543/postgres?pgbouncer=true
WEB_URL=https://app.example.com
API_CORS_ORIGIN=https://app.example.com
BETTER_AUTH_URL=https://app.example.com
BETTER_AUTH_SECRET=replace-with-the-same-secret-used-by-web
ADMIN_DEV_KEY=replace-with-a-strong-admin-only-secret
ROUND_MACHINE_AUTO_START=true
ENABLE_DEV_AUTH=false
ENABLE_REDIS=false
REDIS_URL=
RESEND_API_KEY=replace-with-resend-key
RESEND_FROM_EMAIL=SpinPro <auth@example.com>
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=120
LOG_LEVEL=info
SENTRY_DSN=
```

### Web Service

- Root directory: repository root
- Build pack: Nixpacks
- Install command: `pnpm install --frozen-lockfile`
- Build command: `pnpm --filter @kingspin/db db:generate && pnpm --filter web build`
- Start command: `pnpm --filter web start`
- Port: `3000`
- Health check path: `/`

If your Coolify UI has a single build command field instead of separate install
and build commands, use:

```bash
pnpm install --frozen-lockfile && pnpm --filter @kingspin/db db:generate && pnpm --filter web build
```

Required web environment variables:

```bash
NODE_ENV=production
APP_ENV=production
WEB_URL=https://app.example.com
BETTER_AUTH_URL=https://app.example.com
BETTER_AUTH_SECRET=replace-with-the-same-secret-used-by-api
DATABASE_URL=postgresql://USER:PASSWORD@HOST:6543/postgres?pgbouncer=true
NEXT_PUBLIC_WEB_URL=https://app.example.com
NEXT_PUBLIC_API_URL=https://api.example.com
NEXT_PUBLIC_SOCKET_URL=https://api.example.com/game
RESEND_API_KEY=replace-with-resend-key
RESEND_FROM_EMAIL=SpinPro <auth@example.com>
LOG_LEVEL=info
```

If web and API are separate subdomains, set this on the web service:

```bash
BETTER_AUTH_COOKIE_DOMAIN=.example.com
```

The API AuthBridge validates Better Auth sessions by forwarding the incoming
cookie to `BETTER_AUTH_URL/api/auth/get-session`. For that to work from a
browser, the Better Auth session cookie must be sent to the API domain. Use one
shared parent domain, for example `app.example.com` and `api.example.com`, and
set `BETTER_AUTH_COOKIE_DOMAIN=.example.com`.

## Supabase Postgres

Use Supabase connection strings carefully:

- App runtime can use the pooled connection string in `DATABASE_URL`.
- Migrations currently use `DATABASE_URL`; only restore `DIRECT_URL` if the
  Prisma schema intentionally adds `directUrl` again.
- Back up the database before first staging or production migration. Supabase
  backup availability depends on your plan, and free-tier projects may have
  limited backup/restore guarantees.

If `migrate:deploy` fails with `P1001` against
`db.<project-ref>.supabase.co:5432`, Prisma could not reach Supabase's direct
database endpoint. Supabase direct database hostnames may require IPv6 network
support. First confirm the project is not paused and the password is correct.
Then run the migration from an IPv6-capable environment, enable Supabase's IPv4
add-on, or use Supabase's session pooler connection for the one-off migration
runner. Do not switch production app runtime to an unsafe ad hoc value, and do
not use `db push` as a workaround.

Useful Windows diagnostics:

```powershell
Resolve-DnsName db.<project-ref>.supabase.co -Type AAAA
Resolve-DnsName db.<project-ref>.supabase.co -Type A
Test-NetConnection db.<project-ref>.supabase.co -Port 5432
```

If the host has only an `AAAA` record and `Test-NetConnection` cannot connect,
the current network likely cannot reach Supabase's IPv6-only direct endpoint.

## Prisma Migration Commands

Local development only:

```bash
pnpm --filter @kingspin/db db:migrate
pnpm --filter @kingspin/db db:seed
```

Staging/production:

```bash
pnpm --filter @kingspin/db db:generate
pnpm --filter @kingspin/db migrate:status
pnpm --filter @kingspin/db migrate:deploy
```

Do not run `prisma migrate dev` or `prisma db push` against staging or
production. Do not run migrations automatically on every app start.

The migration included in this repo is an initial schema migration intended for
a fresh staging/closed-alpha database. If you already have a database created by
`db push`, baseline it deliberately before using `migrate deploy`; do not point
this initial migration at an unreviewed live database.

## Redis and Socket.IO

Single API instance closed-alpha can run without Redis, but production logs will
warn. Before horizontal scaling, enable Redis or sticky sessions:

```bash
ENABLE_REDIS=true
REDIS_URL=redis://...
```

The Socket.IO Redis adapter is wired when Redis is enabled. Round-machine Redis
locking remains a future hardening item; PostgreSQL advisory locks are the
active multi-process safety layer.

## Smoke Test

After deploying both services and running migrations manually, run:

```bash
SMOKE_API_URL=https://api.example.com SMOKE_WEB_URL=https://app.example.com pnpm smoke:staging
```

Optional room live-state check:

```bash
SMOKE_API_URL=https://api.example.com SMOKE_WEB_URL=https://app.example.com SMOKE_ROOM_ID=room_id pnpm smoke:staging
```

Expected results:

- `/health` returns ok.
- `/health/db` returns database ok.
- `/categories` returns an array.
- anonymous `/me` returns 401.
- web home returns 2xx.
- optional room live-state returns the requested room.

For the full manual smoke runbook, see
`docs/deployment/closed-alpha-smoke-test.md`.

For static security checks, see `docs/deployment/security-checklist.md`.

## Manual Closed-Alpha Path

1. Deploy the web and API services with production env values.
2. Run `pnpm --filter @kingspin/db migrate:status`.
3. Back up the database.
4. Run `pnpm --filter @kingspin/db migrate:deploy`.
5. Seed or create closed-alpha users/admin data through a safe one-off process.
6. Sign up on the web app.
7. Verify email through Resend.
8. Sign in.
9. Open a SpinPro room.
10. Credit play-money through admin-only tooling.
11. Place an entry through `POST /rooms/:roomId/entries`.
12. Watch socket updates and latest-result fairness proof.

## Readiness Statement

This setup is for secure closed-alpha play-money deployment readiness. It is not
real-money production readiness. Payments, KYC, withdrawals, fraud operations,
formal reconciliation workflows, legal review, and compliance controls remain
future work.
