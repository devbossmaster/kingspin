import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const webRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const sourceDirs = ["app", "components", "hooks", "lib", "stores"];
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return readFileSync(join(webRoot, relativePath), "utf8");
}

function assertFile(relativePath) {
  if (!existsSync(join(webRoot, relativePath))) {
    fail(`Missing required file: ${relativePath}`);
  }
}

function collectFiles(dir) {
  const absoluteDir = join(webRoot, dir);

  if (!existsSync(absoluteDir)) return [];

  return readdirSync(absoluteDir).flatMap((entry) => {
    const absolutePath = join(absoluteDir, entry);
    const stats = statSync(absolutePath);

    if (stats.isDirectory()) {
      return collectFiles(relative(webRoot, absolutePath));
    }

    if (!/\.(ts|tsx|js|jsx)$/.test(entry)) {
      return [];
    }

    return [absolutePath];
  });
}

const sourceFiles = sourceDirs.flatMap(collectFiles);
const sourceByFile = new Map(
  sourceFiles.map((file) => [
    relative(webRoot, file),
    readFileSync(file, "utf8"),
  ]),
);
const allSource = [...sourceByFile.values()].join("\n");

for (const forbidden of [
  "/dev/players",
  "/entries/dev-place",
  "entries/dev-place",
]) {
  if (allSource.includes(forbidden)) {
    fail(`Forbidden public dev route reference found: ${forbidden}`);
  }
}

if (allSource.includes("playerKey")) {
  fail("Forbidden playerKey reference found in frontend source.");
}

const apiClient = read("lib/api-client.ts");
const placeEntryMatch = apiClient.match(
  /placeEntry\(roomId: string, input: PlaceEntryInput\) \{[\s\S]*?\n\s{2}\},/,
);

if (!placeEntryMatch) {
  fail("apiClient.placeEntry was not found.");
} else {
  const placeEntrySource = placeEntryMatch[0];

  if (!placeEntrySource.includes("`/rooms/${roomId}/entries`")) {
    fail("apiClient.placeEntry does not call POST /rooms/:roomId/entries.");
  }

  if (!placeEntrySource.includes("amount: input.amount")) {
    fail("apiClient.placeEntry does not include amount.");
  }

  if (!placeEntrySource.includes("idempotencyKey: input.idempotencyKey")) {
    fail("apiClient.placeEntry does not preserve idempotencyKey.");
  }

  for (const forbidden of [
    "userId",
    "walletId",
    "playerKey",
    "role",
    "balance",
  ]) {
    if (placeEntrySource.includes(forbidden)) {
      fail(
        `apiClient.placeEntry includes forbidden identity/state field: ${forbidden}`,
      );
    }
  }
}

if (!apiClient.includes('"/me/wallet"')) {
  fail("apiClient.getMeWallet must use /me/wallet.");
}

if (!apiClient.includes('"/categories"')) {
  fail("apiClient.getCategories must use /categories.");
}

if (!apiClient.includes("`/rooms/live?${params.toString()}`")) {
  fail("apiClient.getRoomsByCategory must use /rooms/live?categorySlug=.");
}

if (!apiClient.includes("`/rooms/${roomId}/live-state`")) {
  fail("apiClient.getRoomLiveState must use /rooms/:roomId/live-state.");
}

if (!apiClient.includes("`/rooms/${roomId}/rounds/latest-result`")) {
  fail(
    "apiClient.getLatestRoundResult must use /rooms/:roomId/rounds/latest-result.",
  );
}

for (const page of [
  "app/(auth)/sign-in/page.tsx",
  "app/(auth)/sign-up/page.tsx",
  "app/(auth)/forgot-password/page.tsx",
  "app/(auth)/reset-password/page.tsx",
  "app/(auth)/verify-email/page.tsx",
]) {
  assertFile(page);
}

const entryPanel = read("components/spinpro/entry-panel.tsx");
if (!entryPanel.includes("Sign in to enter")) {
  fail("EntryPanel must show an unauthenticated sign-in entry state.");
}

const useRoom = read("hooks/use-room.ts");
for (const socketEvent of [
  "round:state",
  "round:updated",
  "round:locked",
  "round:spinning",
  "round:settled",
  "room:player-joined",
  "room:player-left",
]) {
  if (!useRoom.includes(socketEvent)) {
    fail(`useRoom is missing socket event handling for ${socketEvent}.`);
  }
}

const winnerReveal = read("components/spinpro/winner-reveal.tsx");
if (winnerReveal.toLowerCase().includes("fairness")) {
  fail("WinnerReveal must stay compact and omit fairness proof details.");
}

const fairnessStrip = read("components/spinpro/fairness-strip.tsx");
const roomPage = read("app/spinpro/[categorySlug]/[roomId]/page.tsx");

if (!roomPage.includes("<FairnessStrip")) {
  fail("The live room page must mount the external fairness panel.");
}

if (
  !fairnessStrip.includes("Provably fair") ||
  !fairnessStrip.includes("verifyCompletedFairness") ||
  !fairnessStrip.includes("Verify completed result")
) {
  fail("FairnessStrip must expose completed-result verification.");
}

for (const forbidden of [
  "selectWinner(",
  "selectWinningTicket(",
  "@kingspin/game-engine",
]) {
  if (allSource.includes(forbidden)) {
    fail(`Frontend must not perform winner selection: ${forbidden}`);
  }
}

if (failures.length > 0) {
  console.error("Static frontend safety check failed:");
  for (const message of failures) {
    console.error(`- ${message}`);
  }
  process.exit(1);
}

console.log("Static frontend safety check passed.");
