# Local Redis for Realtime Gameplay

Redis is optional for local development. Postgres remains the source of truth
for wallets, ledger transactions, entries, rounds, payouts, and winners.

Start Redis locally:

```bash
docker run --name kingspin-redis -p 6379:6379 -d redis:7-alpine
```

API env:

```bash
ENABLE_REDIS=true
REDIS_URL=redis://localhost:6379
```

Verify:

```bash
curl http://localhost:4000/health/redis
curl http://localhost:4000/health/realtime
```

Run the entry stress script against a local API:

```bash
STRESS_ROOM_ID=<roomId> STRESS_ADMIN_DEV_KEY=<dev-key> node scripts/stress-entry.mjs
```

The script defaults to a `10,25,50,100` user matrix and prints latency
percentiles plus realtime metric deltas when `/health/realtime` is available.

Redis is used for Socket.IO fanout, short TTL public room snapshot caching,
round-machine distributed locks, entry spam rate limiting, and room presence.
It must not be used as authoritative money or winner state.
