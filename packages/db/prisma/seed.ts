import { createHash, randomBytes } from "node:crypto";
import {
  GameMode,
  PrismaClient,
  RoomStatus,
  RoundStatus,
} from "@prisma/client";

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
      name: "Pro 10–100",
      minEntryAmount: 10n,
      maxEntryAmount: 100n,
      sortOrder: 10,
      roomCode: "PRO-A",
      roomName: "Pro Wheel A",
      gameMode: GameMode.FLEXIBLE_PROPORTIONAL,
      fixedEntryAmount: null,
    },
    {
      slug: "pro-100-200",
      name: "Pro 100–200",
      minEntryAmount: 100n,
      maxEntryAmount: 200n,
      sortOrder: 20,
      roomCode: "PRO-B",
      roomName: "Pro Wheel B",
      gameMode: GameMode.FLEXIBLE_PROPORTIONAL,
      fixedEntryAmount: null,
    },
    {
      slug: "pro-200-350",
      name: "Pro 200–350",
      minEntryAmount: 200n,
      maxEntryAmount: 350n,
      sortOrder: 30,
      roomCode: "PRO-C",
      roomName: "Pro Wheel C",
      gameMode: GameMode.FLEXIBLE_PROPORTIONAL,
      fixedEntryAmount: null,
    },
    {
      slug: "fixed-10",
      name: "Fixed 10",
      minEntryAmount: 10n,
      maxEntryAmount: 10n,
      sortOrder: 110,
      roomCode: "FIX-10",
      roomName: "Fixed Wheel 10",
      gameMode: GameMode.FIXED_EQUAL_CHANCE,
      fixedEntryAmount: 10n,
    },
    {
      slug: "fixed-20",
      name: "Fixed 20",
      minEntryAmount: 20n,
      maxEntryAmount: 20n,
      sortOrder: 120,
      roomCode: "FIX-20",
      roomName: "Fixed Wheel 20",
      gameMode: GameMode.FIXED_EQUAL_CHANCE,
      fixedEntryAmount: 20n,
    },
    {
      slug: "fixed-50",
      name: "Fixed 50",
      minEntryAmount: 50n,
      maxEntryAmount: 50n,
      sortOrder: 130,
      roomCode: "FIX-50",
      roomName: "Fixed Wheel 50",
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
        maxPlayers: 24,
        roundDurationMs: 45_000,
        sortOrder: categoryData.sortOrder,
        isActive: true,
      },
      create: {
        ...categoryData,
        maxPlayers: 24,
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

  console.log("Seeded KingSpin Pro and Fixed categories.");
  console.log("Seeded one ACTIVE permanent room per Pro/Fixed category.");
  console.log("Ensured an active round exists for each seeded permanent room.");
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

  return prisma.round.create({
    data: {
      roomId,
      roundNumber,
      status: RoundStatus.OPEN,
      openedAt,
      locksAt: new Date(openedAt.getTime() + roundDurationMs),
      totalEntryAmount: 0n,
      houseFeeAmount: 0n,
      payoutAmount: 0n,
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
