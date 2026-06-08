import { createHash, randomBytes } from "node:crypto";
import {
  GameMode,
  PrismaClient,
  RoomStatus,
  RoundStatus,
} from "@prisma/client";
import { seedLocalFixtures } from "./local-fixtures";

const prisma = new PrismaClient();

const ACTIVE_ROUND_STATUSES = [
  RoundStatus.OPEN,
  RoundStatus.LOCKED,
  RoundStatus.DRAWING,
  RoundStatus.SPINNING,
  RoundStatus.SETTLING,
];

type BaselineRoomSeed = {
  slug: string;
  name: string;
  minEntryAmount: bigint;
  maxEntryAmount: bigint;
  sortOrder: number;
  roomCode: string;
  roomName: string;
  gameMode: GameMode;
  fixedEntryAmount: bigint | null;
};

async function main() {
  const categories: BaselineRoomSeed[] = [
    {
      slug: "pro-10-100",
      name: "Base",
      minEntryAmount: 10n,
      maxEntryAmount: 100n,
      sortOrder: 10,
      roomCode: "FB01",
      roomName: "FB01",
      gameMode: GameMode.FLEXIBLE_PROPORTIONAL,
      fixedEntryAmount: null,
    },
    {
      slug: "pro-100-200",
      name: "Palace",
      minEntryAmount: 100n,
      maxEntryAmount: 200n,
      sortOrder: 20,
      roomCode: "FP01",
      roomName: "FP01",
      gameMode: GameMode.FLEXIBLE_PROPORTIONAL,
      fixedEntryAmount: null,
    },
    {
      slug: "pro-200-350",
      name: "Empire",
      minEntryAmount: 200n,
      maxEntryAmount: 350n,
      sortOrder: 30,
      roomCode: "FE01",
      roomName: "FE01",
      gameMode: GameMode.FLEXIBLE_PROPORTIONAL,
      fixedEntryAmount: null,
    },
    {
      slug: "fixed-10",
      name: "Base",
      minEntryAmount: 10n,
      maxEntryAmount: 10n,
      sortOrder: 110,
      roomCode: "CB01",
      roomName: "CB01",
      gameMode: GameMode.FIXED_EQUAL_CHANCE,
      fixedEntryAmount: 10n,
    },
    {
      slug: "fixed-20",
      name: "Palace",
      minEntryAmount: 20n,
      maxEntryAmount: 20n,
      sortOrder: 120,
      roomCode: "CP01",
      roomName: "CP01",
      gameMode: GameMode.FIXED_EQUAL_CHANCE,
      fixedEntryAmount: 20n,
    },
    {
      slug: "fixed-50",
      name: "Empire",
      minEntryAmount: 50n,
      maxEntryAmount: 50n,
      sortOrder: 130,
      roomCode: "CE01",
      roomName: "CE01",
      gameMode: GameMode.FIXED_EQUAL_CHANCE,
      fixedEntryAmount: 50n,
    },
  ];

  for (const categorySeed of categories) {
    const { roomCode, roomName, gameMode, fixedEntryAmount, ...categoryData } =
      categorySeed;

    const category = await prisma.category.upsert({
      where: { slug: categoryData.slug },
      update: {
        name: categoryData.name,
        minEntryAmount: categoryData.minEntryAmount,
        maxEntryAmount: categoryData.maxEntryAmount,
        maxPlayers: 30,
        roundDurationMs: 45_000,
        sortOrder: categoryData.sortOrder,
        isActive: true,
      },
      create: {
        ...categoryData,
        maxPlayers: 30,
        roundDurationMs: 45_000,
        isActive: true,
      },
    });

    const room = await prisma.room.upsert({
      where: {
        categoryId_code: {
          categoryId: category.id,
          code: roomCode,
        },
      },
      update: {
        name: roomName,
        status: RoomStatus.ACTIVE,
        gameMode,
        fixedEntryAmount,
        isPermanent: true,
        maxPlayers: category.maxPlayers,
        roundDurationMs: category.roundDurationMs,
        activatedAt: new Date(),
        pausedAt: null,
        closedAt: null,
        archivedAt: null,
      },
      create: {
        categoryId: category.id,
        code: roomCode,
        name: roomName,
        status: RoomStatus.ACTIVE,
        gameMode,
        fixedEntryAmount,
        isPermanent: true,
        maxPlayers: category.maxPlayers,
        roundDurationMs: category.roundDurationMs,
        activatedAt: new Date(),
      },
    });

    await ensureCurrentRound(room.id, room.roundDurationMs);
  }

  console.log("Seeded Spin Battle Jemaw categories.");
  console.log("Seeded one ACTIVE permanent A01 room per category.");
  console.log("Ensured an active round exists for each seeded permanent room.");

  await seedLocalFixtures(prisma);
}

async function ensureCurrentRound(roomId: string, roundDurationMs: number) {
  const activeRound = await prisma.round.findFirst({
    where: {
      roomId,
      status: { in: ACTIVE_ROUND_STATUSES },
    },
    orderBy: { roundNumber: "desc" },
  });

  if (activeRound) {
    return activeRound;
  }

  const latestRound = await prisma.round.findFirst({
    where: { roomId },
    orderBy: { roundNumber: "desc" },
    select: { roundNumber: true },
  });

  const roundNumber = (latestRound?.roundNumber ?? 0) + 1;
  const openedAt = new Date();
  const serverSeed = randomBytes(32).toString("hex");
  const serverSeedHash = createHash("sha256").update(serverSeed).digest("hex");
  const entryCutoffBufferMs = Number(
    process.env.ROUND_ENTRY_CUTOFF_BUFFER_MS ?? 2_000,
  );
  const platformFeeBps = Number(process.env.PLATFORM_FEE_BPS ?? 2_000);

  return prisma.round.create({
    data: {
      roomId,
      roundNumber,
      status: RoundStatus.OPEN,
      openedAt,
      locksAt: new Date(
        openedAt.getTime() +
          Math.max(1_000, roundDurationMs - entryCutoffBufferMs),
      ),
      totalEntryAmount: 0n,
      houseFeeAmount: 0n,
      payoutAmount: 0n,
      platformFeeBps,
      serverSeedHash,
      serverSeedReveal: serverSeed,
      idempotencyKey: `seed:round:start:${roomId}:${roundNumber}`,
    },
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
