import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const envPath = resolve(process.cwd(), "packages/db/.env");

function readEnv(path) {
  const env = new Map();
  const content = readFileSync(path, "utf8");

  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const separator = line.indexOf("=");
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    env.set(key, value);
  }

  return env;
}

function describeUrl(label, value) {
  if (!value) {
    console.log(`${label}: missing`);
    return;
  }

  try {
    const url = new URL(value);

    console.log(`protocol: ${url.protocol.replace(":", "")}`);
    console.log(`username: ${url.username || "<empty>"}`);
    console.log(`host: ${url.hostname}`);
    console.log(`pathname: ${url.pathname || "/"}`);
    console.log(`search: ${url.search || "<none>"}`);
    console.log(`sslmode present: ${url.searchParams.get("sslmode") === "require"}`);
    console.log(`pooler host: ${url.hostname.includes("pooler.supabase.com")}`);
  } catch (error) {
    console.log(`${label}: unparseable (${error.message})`);
  }
}

const env = readEnv(envPath);

describeUrl("DATABASE_URL", env.get("DATABASE_URL"));
