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
