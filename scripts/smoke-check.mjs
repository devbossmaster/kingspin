import process from "node:process";

const apiUrl = trimTrailingSlash(
  process.env.SMOKE_API_URL ?? process.env.NEXT_PUBLIC_API_URL,
);
const webUrl = trimTrailingSlash(
  process.env.SMOKE_WEB_URL ??
    process.env.NEXT_PUBLIC_WEB_URL ??
    process.env.WEB_URL,
);
const roomId = process.env.SMOKE_ROOM_ID;

const checks = [];

function trimTrailingSlash(value) {
  if (!value) return "";

  return value.replace(/\/+$/, "");
}

function addCheck(name, run) {
  checks.push({ name, run });
}

async function get(url) {
  return fetch(url, {
    method: "GET",
    headers: { accept: "application/json,text/html" },
  });
}

async function readJson(response) {
  return response.json().catch(() => null);
}

if (!apiUrl) {
  console.error("SMOKE_API_URL or NEXT_PUBLIC_API_URL is required.");
  process.exit(1);
}

addCheck("API health", async () => {
  const response = await get(`${apiUrl}/health`);
  const body = await readJson(response);

  if (!response.ok || body?.status !== "ok") {
    throw new Error(`Expected /health status ok, got ${response.status}.`);
  }
});

addCheck("API database health", async () => {
  const response = await get(`${apiUrl}/health/db`);
  const body = await readJson(response);

  if (!response.ok || body?.database?.status !== "ok") {
    throw new Error(`Expected /health/db database ok, got ${response.status}.`);
  }
});

addCheck("API Redis health", async () => {
  const response = await get(`${apiUrl}/health/redis`);
  const body = await readJson(response);

  if (!response.ok || body?.redis?.available !== true) {
    throw new Error(
      `Expected /health/redis Redis available, got ${response.status}.`,
    );
  }
});

addCheck("API round machine health", async () => {
  const response = await get(`${apiUrl}/health/round-machine`);
  const body = await readJson(response);
  const roundMachine = body?.roundMachine;
  const activePermanent = roundMachine?.rooms?.activePermanent ?? 0;
  const runningPermanent = roundMachine?.rooms?.runningPermanent ?? 0;
  const staleCompleted =
    roundMachine?.staleRounds?.staleCompletedOrCurrent ?? 0;
  const staleWarnings = roundMachine?.staleRounds?.warnings ?? 0;

  if (!response.ok || body?.status !== "ok") {
    throw new Error(
      `Expected /health/round-machine status ok, got ${response.status}/${body?.status ?? "unknown"}.`,
    );
  }

  if (body?.database?.status !== "ok") {
    throw new Error("Expected /health/round-machine database ok.");
  }

  if (body?.redis?.available !== true) {
    throw new Error("Expected /health/round-machine Redis available.");
  }

  if (roundMachine?.enabled !== true) {
    throw new Error("Expected round machine auto-start enabled.");
  }

  if (activePermanent > 0 && runningPermanent !== activePermanent) {
    throw new Error(
      `Expected all active permanent rooms running, got ${runningPermanent}/${activePermanent}.`,
    );
  }

  if (activePermanent > 0 && !roundMachine.lastTickAt) {
    throw new Error("Expected round machine lastTickAt to be present.");
  }

  if (staleCompleted > 0 || staleWarnings > 0) {
    throw new Error(
      `Expected no stale round warnings, got staleCompletedOrCurrent=${staleCompleted}, warnings=${staleWarnings}.`,
    );
  }
});

addCheck("Categories public endpoint", async () => {
  const response = await get(`${apiUrl}/categories`);
  const body = await readJson(response);

  if (!response.ok || !Array.isArray(body)) {
    throw new Error(`Expected /categories array, got ${response.status}.`);
  }
});

addCheck("Protected /me rejects anonymous", async () => {
  const response = await get(`${apiUrl}/me`);

  if (response.status !== 401) {
    throw new Error(`Expected /me to return 401, got ${response.status}.`);
  }
});

if (roomId) {
  addCheck("Room live-state", async () => {
    const response = await get(`${apiUrl}/rooms/${roomId}/live-state`);
    const body = await readJson(response);

    if (!response.ok || body?.room?.id !== roomId) {
      throw new Error(
        `Expected live-state for room ${roomId}, got ${response.status}.`,
      );
    }
  });
}

if (webUrl) {
  addCheck("Web home", async () => {
    const response = await fetch(webUrl, { method: "GET" });

    if (!response.ok) {
      throw new Error(`Expected web home 2xx, got ${response.status}.`);
    }
  });
}

let failed = false;

for (const check of checks) {
  try {
    await check.run();
    console.log(`PASS ${check.name}`);
  } catch (error) {
    failed = true;
    const message = error instanceof Error ? error.message : String(error);
    console.error(`FAIL ${check.name}: ${message}`);
  }
}

if (failed) {
  process.exit(1);
}

console.log("Smoke checks passed.");
