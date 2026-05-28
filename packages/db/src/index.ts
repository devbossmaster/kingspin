import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
  prismaDatabaseUrl?: string;
};

const cachedPrisma =
  globalForPrisma.prismaDatabaseUrl === process.env.DATABASE_URL
    ? globalForPrisma.prisma
    : undefined;

if (
  process.env.NODE_ENV !== "production" &&
  globalForPrisma.prisma &&
  !cachedPrisma
) {
  void globalForPrisma.prisma.$disconnect();
}

export const prisma =
  cachedPrisma ??
  new PrismaClient({
    log:
      process.env.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
  globalForPrisma.prismaDatabaseUrl = process.env.DATABASE_URL;
}

export * from "@prisma/client";
