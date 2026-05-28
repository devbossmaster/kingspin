#!/usr/bin/env node

const apiUrl = process.env.STRESS_API_URL ?? "http://localhost:4000";
const roomId = process.env.STRESS_ROOM_ID;
const userMatrix = (process.env.STRESS_MATRIX ?? process.env.STRESS_USERS ?? "10,25,50,100")
  .split(",")
  .map((value) => Number(value.trim()))
  .filter((value) => Number.isFinite(value) && value > 0);
const amount = Number(process.env.STRESS_AMOUNT ?? 10);
const configuredConcurrency = process.env.STRESS_CONCURRENCY
  ? Number(process.env.STRESS_CONCURRENCY)
  : null;
const adminDevKey =
  process.env.STRESS_ADMIN_DEV_KEY ?? process.env.ADMIN_DEV_KEY;
const authCookie = process.env.STRESS_COOKIE;
const runId = process.env.STRESS_RUN_ID ?? `stress-${Date.now().toString(36)}`;
const useAdminDevRoute = !!adminDevKey;

if (!roomId) {
  console.error("STRESS_ROOM_ID is required.");
  process.exit(1);
}

if (!useAdminDevRoute && !authCookie) {
  console.error(
    "Set STRESS_ADMIN_DEV_KEY for the existing local/dev admin entry route, or STRESS_COOKIE for the production entry route.",
  );
  process.exit(1);
}

if (userMatrix.length === 0) {
  console.error("STRESS_MATRIX/STRESS_USERS must contain positive numbers.");
  process.exit(1);
}

if (!Number.isFinite(amount) || amount <= 0) {
  console.error("STRESS_AMOUNT must be a positive number.");
  process.exit(1);
}

if (
  configuredConcurrency !== null &&
  (!Number.isFinite(configuredConcurrency) || configuredConcurrency <= 0)
) {
  console.error("STRESS_CONCURRENCY must be a positive number.");
  process.exit(1);
}

function percentile(sorted, rank) {
  if (sorted.length === 0) {
    return 0;
  }

  const index = Math.min(
    sorted.length - 1,
    Math.max(0, Math.ceil((rank / 100) * sorted.length) - 1),
  );

  return sorted[index];
}

function diffMetrics(before, after) {
  const beforeMetrics = before?.metrics;
  const afterMetrics = after?.metrics;

  if (!beforeMetrics || !afterMetrics) {
    return null;
  }

  const diff = {};

  for (const [key, value] of Object.entries(afterMetrics)) {
    const previous = beforeMetrics[key];

    if (typeof value === "number" && typeof previous === "number") {
      diff[key] = value - previous;
    }
  }

  return diff;
}

function summarize(results, args) {
  const durations = results
    .map((result) => result.durationMs)
    .sort((left, right) => left - right);
  const statusCounts = new Map();

  for (const result of results) {
    statusCounts.set(result.status, (statusCounts.get(result.status) ?? 0) + 1);
  }

  const summary = {
    runId,
    users: args.users,
    amount,
    concurrency: args.concurrency,
    route: useAdminDevRoute ? "admin-dev-place" : "production-entry",
    success: results.filter((result) => result.ok).length,
    errors: results.filter((result) => !result.ok).length,
    min: durations[0] ?? 0,
    p50: percentile(durations, 50),
    p90: percentile(durations, 90),
    p95: percentile(durations, 95),
    p99: percentile(durations, 99),
    max: durations[durations.length - 1] ?? 0,
    statuses: Object.fromEntries(statusCounts.entries()),
    realtimeMetricsDelta: diffMetrics(args.metricsBefore, args.metricsAfter),
  };

  console.log(JSON.stringify(summary, null, 2));

  if (summary.p95 > 3000 || summary.max > 8000) {
    console.warn(
      `Latency warning: p95=${Math.round(summary.p95)}ms max=${Math.round(summary.max)}ms`,
    );
  }
}

async function runPool(items, limit, worker) {
  const results = [];
  let cursor = 0;

  async function next() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index], index);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, () => next()),
  );

  return results;
}

async function fetchRealtimeMetrics() {
  try {
    const response = await fetch(`${apiUrl}/health/realtime`);

    if (!response.ok) {
      return null;
    }

    return response.json();
  } catch {
    return null;
  }
}

async function postEntry(index, users) {
  const startedAt = performance.now();
  const idempotencyKey = `${runId}:${users}:entry:${index}`;
  const playerKey = `${runId}-${users}-user-${index}`;
  const path = useAdminDevRoute
    ? `/admin/rooms/${encodeURIComponent(roomId)}/entries/dev-place`
    : `/rooms/${encodeURIComponent(roomId)}/entries`;
  const body = useAdminDevRoute
    ? { amount, playerKey, idempotencyKey }
    : { amount, idempotencyKey };
  const headers = {
    "content-type": "application/json",
    ...(useAdminDevRoute ? { "x-admin-dev-key": adminDevKey } : {}),
    ...(!useAdminDevRoute && authCookie ? { cookie: authCookie } : {}),
  };

  try {
    const response = await fetch(`${apiUrl}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });
    const text = await response.text();

    return {
      ok: response.ok,
      status: response.status,
      durationMs: performance.now() - startedAt,
      body: text.slice(0, 300),
    };
  } catch (error) {
    return {
      ok: false,
      status: "NETWORK_ERROR",
      durationMs: performance.now() - startedAt,
      body: error instanceof Error ? error.message : String(error),
    };
  }
}

console.log(
  `[stress-entry] run=${runId} room=${roomId} matrix=${userMatrix.join(",")} amount=${amount} api=${apiUrl} route=${
    useAdminDevRoute ? "admin-dev-place" : "production-entry"
  }`,
);

let hasFailures = false;

for (const users of userMatrix) {
  const concurrency = Math.min(configuredConcurrency ?? users, users);
  const metricsBefore = await fetchRealtimeMetrics();

  console.log(
    `[stress-entry] batch users=${users} concurrency=${concurrency}`,
  );

  const results = await runPool(
    Array.from({ length: users }, (_value, index) => index),
    concurrency,
    (index) => postEntry(index, users),
  );

  const metricsAfter = await fetchRealtimeMetrics();

  summarize(results, {
    users,
    concurrency,
    metricsBefore,
    metricsAfter,
  });

  const failures = results.filter((result) => !result.ok);

  if (failures.length > 0) {
    hasFailures = true;
    console.error(
      JSON.stringify(
        {
          users,
          failures: failures.slice(0, 10),
          note: "Showing first 10 failures.",
        },
        null,
        2,
      ),
    );
  }
}

if (hasFailures) {
  process.exitCode = 1;
}
