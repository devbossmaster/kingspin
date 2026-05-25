import { PrismaClient, RoomStatus } from "@prisma/client";

const prisma = new PrismaClient();

const COIN = 100n;

async function main() {
  const categories = [
    {
      name: "Jemaw 1",
      slug: "jemaw-1",
      minEntryAmount: 10n * COIN,
      maxEntryAmount: 50n * COIN,
      maxPlayers: 24,
      roundDurationMs: 45_000,
      sortOrder: 1,
      initialRoomCode: "A01",
      initialRoomName: "Jemaw 1 Arena A01",
    },
    {
      name: "Jemaw 2",
      slug: "jemaw-2",
      minEntryAmount: 50n * COIN,
      maxEntryAmount: 100n * COIN,
      maxPlayers: 24,
      roundDurationMs: 45_000,
      sortOrder: 2,
      initialRoomCode: "B01",
      initialRoomName: "Jemaw 2 Arena B01",
    },
    {
      name: "Jemaw 3",
      slug: "jemaw-3",
      minEntryAmount: 100n * COIN,
      maxEntryAmount: 200n * COIN,
      maxPlayers: 24,
      roundDurationMs: 45_000,
      sortOrder: 3,
      initialRoomCode: "C01",
      initialRoomName: "Jemaw 3 Arena C01",
    },
  ];

  for (const categorySeed of categories) {
    const {
      initialRoomCode,
      initialRoomName,
      ...categoryData
    } = categorySeed;

    const category = await prisma.category.upsert({
      where: { slug: categoryData.slug },
      update: {
        name: categoryData.name,
        minEntryAmount: categoryData.minEntryAmount,
        maxEntryAmount: categoryData.maxEntryAmount,
        maxPlayers: categoryData.maxPlayers,
        roundDurationMs: categoryData.roundDurationMs,
        sortOrder: categoryData.sortOrder,
        isActive: true,
      },
      create: {
        ...categoryData,
        isActive: true,
      },
    });

    await prisma.room.upsert({
      where: {
        categoryId_code: {
          categoryId: category.id,
          code: initialRoomCode,
        },
      },
      update: {
        name: initialRoomName,
        status: RoomStatus.ACTIVE,
        isPermanent: true,
        maxPlayers: category.maxPlayers,
        roundDurationMs: category.roundDurationMs,
      },
      create: {
        categoryId: category.id,
        code: initialRoomCode,
        name: initialRoomName,
        status: RoomStatus.ACTIVE,
        isPermanent: true,
        maxPlayers: category.maxPlayers,
        roundDurationMs: category.roundDurationMs,
        activatedAt: new Date(),
      },
    });
  }

  console.log("Seeded KingSpin categories.");
  console.log("Seeded one initial ACTIVE room per category: A01, B01, C01.");
  console.log("Runtime auto-spawning is disabled by design. Admin manages additional rooms manually.");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
