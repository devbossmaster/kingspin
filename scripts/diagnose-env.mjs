import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const envFiles = [
  "packages/db/.env",
  "apps/api/.env",
  "apps/web/.env",
  "apps/web/.env.local",
  ".env",
  "apps/api/.env.example",
  "apps/web/.env.example",
];

const expectations = [
  ["Prisma", "packages/db/.env"],
  ["API", "apps/api/.env"],
  ["Web", "apps/web/.env"],
];

function readEnv(file) {
  const env = new Map();

  if (!existsSync(file)) {
    return env;
  }

  const content = readFileSync(file, "utf8");

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

function describeDatabaseUrl(value) {
  if (!value) {
    return "missing";
  }

  try {
    const url = new URL(value);
    return [
      `username=${url.username || "<empty>"}`,
      `host=${url.hostname}`,
      `pathname=${url.pathname || "/"}`,
      `query=${url.search || "<none>"}`,
      `sslmode=require:${url.searchParams.get("sslmode") === "require"}`,
    ].join(", ");
  } catch {
    return "unparseable";
  }
}

function reportExists(key, env) {
  const value = env.get(key);
  return `${key}:${Boolean(value && value.trim().length > 0)}`;
}

console.log("env files:");
for (const file of envFiles) {
  console.log(`  ${file}: ${existsSync(file)}`);
}

console.log("expected loaders:");
for (const [name, file] of expectations) {
  console.log(`  ${name}: ${resolve(process.cwd(), file)}`);
}

for (const file of ["packages/db/.env", "apps/api/.env", "apps/web/.env"]) {
  const env = readEnv(file);
  console.log(`${file}:`);
  console.log(`  DATABASE_URL: ${describeDatabaseUrl(env.get("DATABASE_URL"))}`);
  console.log(`  APP_ENV: ${env.get("APP_ENV") ?? "<missing>"}`);
  console.log(`  DEPLOY_ENV: ${env.get("DEPLOY_ENV") ?? "<missing>"}`);
  console.log(`  WEB_URL: ${env.get("WEB_URL") ?? "<missing>"}`);
  console.log(`  BETTER_AUTH_URL: ${env.get("BETTER_AUTH_URL") ?? "<missing>"}`);
  console.log(
    `  NEXT_PUBLIC_API_URL: ${env.get("NEXT_PUBLIC_API_URL") ?? "<missing>"}`,
  );
  console.log(
    `  NEXT_PUBLIC_SOCKET_URL: ${
      env.get("NEXT_PUBLIC_SOCKET_URL") ?? "<missing>"
    }`,
  );
  console.log(
    `  required: ${[
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "RESEND_API_KEY",
      "EMAIL_FROM",
      "RESEND_FROM_EMAIL",
      "ADMIN_DEV_KEY",
    ]
      .map((key) => reportExists(key, env))
      .join(", ")}`,
  );
}
