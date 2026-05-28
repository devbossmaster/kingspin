import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import process from "node:process";
import { execFileSync } from "node:child_process";

const root = process.cwd();
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(path) {
  return readFileSync(join(root, path), "utf8");
}

function collectFiles(dir, predicate = () => true) {
  const absoluteDir = join(root, dir);

  if (!existsSync(absoluteDir)) return [];

  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = join(absoluteDir, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      if (["node_modules", ".next", "dist", "coverage"].includes(entry)) {
        return [];
      }

      return collectFiles(relative(root, absolutePath), predicate);
    }

    const relativePath = relative(root, absolutePath).replaceAll("\\", "/");

    return predicate(relativePath) ? [relativePath] : [];
  });
}

function assertDoesNotContain(files, patterns, label) {
  for (const file of files) {
    const source = read(file);

    for (const pattern of patterns) {
      const matched =
        typeof pattern === "string" ? source.includes(pattern) : pattern.test(source);

      if (matched) {
        fail(`${label}: ${file} matched ${pattern.toString()}`);
      }
    }
  }
}

const frontendFiles = collectFiles("apps/web", (file) =>
  /\.(ts|tsx|js|jsx|mjs)$/.test(file) && !file.includes("/scripts/"),
);
const apiPublicFiles = collectFiles("apps/api/src", (file) => {
  if (!/\.(ts|js)$/.test(file)) return false;
  if (file.includes(".spec.")) return false;
  if (file.includes("/modules/admin/")) return false;

  return true;
});
const sourceFiles = [
  ...collectFiles("apps", (file) => /\.(ts|tsx|js|jsx|mjs)$/.test(file)),
  ...collectFiles("packages", (file) => /\.(ts|tsx|js|jsx|mjs|prisma)$/.test(file)),
];

assertDoesNotContain(
  frontendFiles,
  ["/dev/players", "/entries/dev-place", "entries/dev-place", "playerKey"],
  "Frontend must not use public dev identity flow",
);

assertDoesNotContain(
  apiPublicFiles,
  ['@Controller("dev', "@Controller('dev", '@Post("dev-place")', "@Post('dev-place')"],
  "API public modules must not expose dev identity routes",
);

assertDoesNotContain(
  collectFiles("apps/api/src", (file) => /\.(ts|js)$/.test(file)),
  [/origin\s*:\s*true/, /origin\s*:\s*["']\*["']/],
  "API must not use wildcard CORS",
);

assertDoesNotContain(
  sourceFiles,
  [
    /NEXT_PUBLIC_[A-Z0-9_]*(SECRET|KEY|TOKEN)\s*=/,
    /sk_live_[A-Za-z0-9]+/,
    /AKIA[0-9A-Z]{16}/,
    /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/,
  ],
  "Source must not contain obvious hardcoded secrets",
);

const apiClient = read("apps/web/lib/api-client.ts");
const placeEntryMatch = apiClient.match(
  /placeEntry\(roomId: string, input: PlaceEntryInput\) \{[\s\S]*?\n\s{2}\},/,
);

if (!placeEntryMatch) {
  fail("apiClient.placeEntry was not found.");
} else {
  const placeEntrySource = placeEntryMatch[0];

  for (const forbidden of ["userId", "walletId", "playerKey", "role", "balance"]) {
    if (placeEntrySource.includes(forbidden)) {
      fail(`apiClient.placeEntry includes forbidden field: ${forbidden}`);
    }
  }
}

const trackedFiles = execFileSync("git", ["ls-files"], {
  cwd: root,
  encoding: "utf8",
})
  .split(/\r?\n/)
  .filter(Boolean)
  .map((file) => file.replaceAll("\\", "/"));

for (const file of trackedFiles) {
  const name = file.split("/").at(-1) ?? "";

  if (name.startsWith(".env") && name !== ".env.example") {
    fail(`Tracked env file must not be committed: ${file}`);
  }
}

const nextConfig = read("apps/web/next.config.js");
for (const header of [
  "X-Frame-Options",
  "X-Content-Type-Options",
  "Referrer-Policy",
  "Permissions-Policy",
  "Content-Security-Policy",
]) {
  if (!nextConfig.includes(header)) {
    fail(`Next security header missing: ${header}`);
  }
}

if (failures.length > 0) {
  console.error("Static security check failed:");
  for (const message of failures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log("Static security check passed.");
