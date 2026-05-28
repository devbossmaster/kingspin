# SpinPro Web

Next.js 16 App Router frontend for SpinPro player auth, lobby, live rooms, and wallet-aware entry actions.

## Environment

Use `apps/web/.env` for local web environment values. The web app no longer
uses `apps/web/.env.local`.

Set `APP_ENV` (or `DEPLOY_ENV`) explicitly:

- `local` for developer builds, including `next build` with localhost URLs
- `staging` for closed-alpha/staging builds
- `production` for real production deploys

Required for auth:

- `BETTER_AUTH_SECRET`
- `BETTER_AUTH_URL` or `WEB_URL`
- `DATABASE_URL`
- `BETTER_AUTH_COOKIE_DOMAIN` when web and API use separate subdomains

Required for game API integration:

- `NEXT_PUBLIC_API_URL`, for example `http://localhost:4000`
- `NEXT_PUBLIC_SOCKET_URL`, for example `http://localhost:4000/game`

Required for auth email delivery outside local placeholder mode:

- `RESEND_API_KEY`
- `RESEND_FROM_EMAIL` or `EMAIL_FROM`

When `APP_ENV=production`, `WEB_URL`, `BETTER_AUTH_URL`,
`NEXT_PUBLIC_API_URL`, and `NEXT_PUBLIC_SOCKET_URL` must use deployed HTTPS
origins, and Resend credentials plus a sender must be real values. Local
Resend placeholders are only accepted with `APP_ENV=local`.

Optional:

- `NEXT_PUBLIC_WEB_URL`

## Local Commands

```bash
pnpm --filter web dev
pnpm --filter web check-types
pnpm --filter web build
```

Protected game and wallet calls use cookies and `credentials: "include"`. The web app does not send `playerKey`, `userId`, `walletId`, role, or balance for player entry actions.

When deployed as `app.example.com` plus `api.example.com`, set
`BETTER_AUTH_COOKIE_DOMAIN=.example.com` so the API can receive the Better Auth
session cookie and validate it through AuthBridge.
