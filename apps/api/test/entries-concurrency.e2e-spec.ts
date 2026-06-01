import { BadRequestException } from '@nestjs/common';
import {
  LedgerEntryDirection,
  LedgerTransactionType,
  Prisma,
  RoomStatus,
  RoundStatus,
  WalletAccountType,
} from '@kingspin/db';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { EntriesService } from '../src/modules/entries/entries.service';
import { RoundsService } from '../src/modules/rounds/rounds.service';
import { PrismaService } from '../src/prisma/prisma.service';

jest.setTimeout(180_000);

type StressFixture = {
  runId: string;
  categoryId: string;
  roomId: string;
  roundId: string;
  userIds: string[];
  walletIds: string[];
  amount: number;
  startingBalance: bigint;
};

type MeasuredResult<T> =
  | {
      ok: true;
      durationMs: number;
      value: T;
    }
  | {
      ok: false;
      durationMs: number;
      error: unknown;
    };

type StressSummary = {
  name: string;
  totalRequests: number;
  successCount: number;
  errorCount: number;
  min: number;
  max: number;
  p50: number;
  p90: number;
  p95: number;
  p99: number;
};

let prisma: PrismaService;
let entriesService: EntriesService;
let roundsService: RoundsService;
const runIds = new Set<string>();
const summaries: StressSummary[] = [];

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) {
    process.env.DATABASE_URL = withStressConnectionLimit(
      process.env.DATABASE_URL,
    );
    return;
  }

  const envPaths = [
    resolve(__dirname, '../.env'),
    resolve(__dirname, '../../../packages/db/.env'),
  ];

  for (const envPath of envPaths) {
    if (!existsSync(envPath)) {
      continue;
    }

    const line = readFileSync(envPath, 'utf8')
      .split(/\r?\n/)
      .find((candidate) => candidate.startsWith('DATABASE_URL='));

    if (!line) {
      continue;
    }

    process.env.DATABASE_URL = withStressConnectionLimit(
      line.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, ''),
    );
    return;
  }
}

function withStressConnectionLimit(databaseUrl: string) {
  const connectionLimit = process.env.STRESS_DB_CONNECTION_LIMIT ?? '10';

  try {
    const url = new URL(databaseUrl);

    url.searchParams.set('connection_limit', connectionLimit);

    if (!url.searchParams.has('pool_timeout')) {
      url.searchParams.set('pool_timeout', '60');
    }

    return url.toString();
  } catch {
    return databaseUrl;
  }
}

function describeDatabaseUrl(databaseUrl: string | undefined) {
  if (!databaseUrl) {
    return 'DATABASE_URL=missing';
  }

  try {
    const url = new URL(databaseUrl);
    const host = url.hostname;
    const hostKind = host.includes('pooler.supabase')
      ? 'supabase-pooler'
      : host.includes('supabase')
        ? 'supabase-direct'
        : host === 'localhost' || host === '127.0.0.1'
          ? 'local-postgres'
          : 'remote-postgres';

    return [
      `kind=${hostKind}`,
      `host=${host}`,
      `database=${url.pathname.replace(/^\//, '') || 'unknown'}`,
      `connection_limit=${url.searchParams.get('connection_limit') ?? 'default'}`,
      `pool_timeout=${url.searchParams.get('pool_timeout') ?? 'default'}`,
      `label=${process.env.STRESS_DB_CONNECTION_LABEL ?? 'default'}`,
    ].join(' ');
  } catch {
    return 'DATABASE_URL=unparseable';
  }
}

async function logDatabaseDiagnostics(label: string) {
  try {
    const settings = await prisma.$queryRaw<
      {
        maxConnections: string;
        currentDatabase: string;
        serverAddress: string | null;
        serverPort: number | null;
      }[]
    >(Prisma.sql`
      SELECT
        current_setting('max_connections') AS "maxConnections",
        current_database() AS "currentDatabase",
        inet_server_addr()::text AS "serverAddress",
        inet_server_port() AS "serverPort"
    `);
    const setting = settings[0];

    console.log(
      [
        `[entry-stress-db] label=${label}`,
        `max_connections=${setting?.maxConnections ?? 'unknown'}`,
        `database=${setting?.currentDatabase ?? 'unknown'}`,
        `server=${setting?.serverAddress ?? 'unknown'}:${setting?.serverPort ?? 'unknown'}`,
      ].join(' '),
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(`[entry-stress-db] label=${label} settings unavailable: ${message}`);
  }

  try {
    const activity = await prisma.$queryRaw<
      {
        state: string;
        waitEventType: string;
        waitEvent: string;
        count: number;
      }[]
    >(Prisma.sql`
      SELECT
        COALESCE(state, 'unknown') AS "state",
        COALESCE(wait_event_type, 'none') AS "waitEventType",
        COALESCE(wait_event, 'none') AS "waitEvent",
        COUNT(*)::int AS "count"
      FROM pg_stat_activity
      WHERE datname = current_database()
      GROUP BY 1, 2, 3
      ORDER BY COUNT(*) DESC
    `);

    const summary = activity
      .map(
        (row) =>
          `${row.state}/${row.waitEventType}/${row.waitEvent}:${row.count}`,
      )
      .join(', ');

    console.log(
      `[entry-stress-db] label=${label} pg_stat_activity=${summary || 'empty'}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(
      `[entry-stress-db] label=${label} pg_stat_activity unavailable: ${message}`,
    );
  }
}

function createRunId() {
  return `stress-${randomUUID().slice(0, 8)}`;
}

async function createFixture(options?: {
  users?: number;
  amount?: number;
  startingBalance?: bigint;
  maxEntryAmount?: bigint;
}) {
  const runId = createRunId();
  runIds.add(runId);

  const users = options?.users ?? 1;
  const amount = options?.amount ?? 10;
  const startingBalance = options?.startingBalance ?? 100n;
  const categoryId = `${runId}-category`;
  const roomId = `${runId}-room`;
  const roundId = `${runId}-round`;
  const now = new Date();
  const userIds = Array.from(
    { length: users },
    (_value, index) => `${runId}-user-${index}`,
  );
  const walletIds = userIds.map((userId) => `${userId}-main-wallet`);

  await prisma.category.create({
    data: {
      id: categoryId,
      name: `${runId} category`,
      slug: `${runId}-category`,
      minEntryAmount: BigInt(amount),
      maxEntryAmount: options?.maxEntryAmount ?? 1_000_000n,
      maxPlayers: Math.max(users, 24),
      roundDurationMs: 45_000,
      isActive: true,
    },
  });

  await prisma.room.create({
    data: {
      id: roomId,
      categoryId,
      code: `${runId}-room`,
      name: `${runId} room`,
      status: RoomStatus.ACTIVE,
      isPermanent: false,
      maxPlayers: Math.max(users, 24),
      roundDurationMs: 45_000,
      activatedAt: now,
    },
  });

  await prisma.round.create({
    data: {
      id: roundId,
      roomId,
      roundNumber: 1,
      status: RoundStatus.OPEN,
      openedAt: now,
      locksAt: new Date(now.getTime() + 45_000),
      totalEntryAmount: 0n,
      payoutAmount: 0n,
      idempotencyKey: `${runId}:round:start`,
    },
  });

  await prisma.user.createMany({
    data: userIds.map((userId, index) => ({
      id: userId,
      email: `${userId}@kingspin.local`,
      username: `${runId}_user_${index}`.replace(/-/g, '_'),
      fullName: `Stress User ${index}`,
      emailVerified: true,
    })),
  });

  await prisma.walletAccount.createMany({
    data: userIds.map((userId, index) => ({
      id: walletIds[index],
      userId,
      type: WalletAccountType.MAIN,
      balanceSnapshot: startingBalance,
    })),
  });

  return {
    runId,
    categoryId,
    roomId,
    roundId,
    userIds,
    walletIds,
    amount,
    startingBalance,
  };
}

async function cleanupRun(runId: string) {
  const idempotencyPrefix = `${runId}:%`;

  await prisma.$executeRaw(Prisma.sql`
    DELETE FROM ledger_entries
    WHERE "transactionId" IN (
      SELECT id
      FROM ledger_transactions
      WHERE "idempotencyKey" LIKE ${idempotencyPrefix}
    )
  `);

  await prisma.ledgerTransaction.deleteMany({
    where: {
      idempotencyKey: {
        startsWith: `${runId}:`,
      },
    },
  });

  await prisma.entry.deleteMany({
    where: {
      roundId: {
        startsWith: runId,
      },
    },
  });

  await prisma.walletAccount.deleteMany({
    where: {
      userId: {
        startsWith: runId,
      },
    },
  });

  await prisma.round.deleteMany({
    where: {
      id: {
        startsWith: runId,
      },
    },
  });

  await prisma.room.deleteMany({
    where: {
      id: {
        startsWith: runId,
      },
    },
  });

  await prisma.category.deleteMany({
    where: {
      id: {
        startsWith: runId,
      },
    },
  });

  await prisma.user.deleteMany({
    where: {
      id: {
        startsWith: runId,
      },
    },
  });
}

async function cleanupFixture(fixture: StressFixture) {
  await cleanupRun(fixture.runId);
}

async function placeEntry(
  fixture: StressFixture,
  userId: string,
  amount: number,
  idempotencyKey: string,
) {
  const startedAt = performance.now();

  try {
    const value = await entriesService.placeEntryForUser({
      roomId: fixture.roomId,
      userId,
      amount,
      idempotencyKey,
    });

    return {
      ok: true,
      value,
      durationMs: performance.now() - startedAt,
    } satisfies MeasuredResult<typeof value>;
  } catch (error) {
    return {
      ok: false,
      error,
      durationMs: performance.now() - startedAt,
    } satisfies MeasuredResult<unknown>;
  }
}

function summarize(name: string, results: MeasuredResult<unknown>[]) {
  const durations = results
    .map((result) => result.durationMs)
    .sort((left, right) => left - right);
  const percentile = (rank: number) => {
    if (durations.length === 0) {
      return 0;
    }

    const index = Math.min(
      durations.length - 1,
      Math.max(0, Math.ceil((rank / 100) * durations.length) - 1),
    );

    return durations[index];
  };

  const summary = {
    name,
    totalRequests: results.length,
    successCount: results.filter((result) => result.ok).length,
    errorCount: results.filter((result) => !result.ok).length,
    min: durations[0] ?? 0,
    max: durations[durations.length - 1] ?? 0,
    p50: percentile(50),
    p90: percentile(90),
    p95: percentile(95),
    p99: percentile(99),
  };

  summaries.push(summary);

  const line = [
    `[entry-stress] ${summary.name}`,
    `requests=${summary.totalRequests}`,
    `success=${summary.successCount}`,
    `errors=${summary.errorCount}`,
    `min=${Math.round(summary.min)}ms`,
    `p50=${Math.round(summary.p50)}ms`,
    `p90=${Math.round(summary.p90)}ms`,
    `p95=${Math.round(summary.p95)}ms`,
    `p99=${Math.round(summary.p99)}ms`,
    `max=${Math.round(summary.max)}ms`,
  ].join(' ');

  console.log(line);

  const strict = process.env.STRESS_LATENCY_STRICT === 'true';

  if (strict) {
    expect(summary.p95).toBeLessThanOrEqual(3_000);
    expect(summary.max).toBeLessThanOrEqual(8_000);
    return summary;
  }

  if (summary.p95 > 3_000 || summary.max > 8_000) {
    console.warn(
      `[entry-stress] ${summary.name} exceeded non-strict latency warning: p95=${Math.round(summary.p95)}ms max=${Math.round(summary.max)}ms`,
    );
  }

  return summary;
}

function successful<T>(results: MeasuredResult<T>[]) {
  return results.filter(
    (result): result is Extract<MeasuredResult<T>, { ok: true }> => result.ok,
  );
}

function failed<T>(results: MeasuredResult<T>[]) {
  return results.filter(
    (result): result is Extract<MeasuredResult<T>, { ok: false }> => !result.ok,
  );
}

function getStressUserMatrix() {
  const rawMatrix =
    process.env.STRESS_MATRIX ?? process.env.STRESS_USERS ?? '10,25,50,100';

  return rawMatrix
    .split(',')
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isFinite(value) && value > 0);
}

function sumBigInts(values: bigint[]) {
  return values.reduce((sum, value) => sum + value, 0n);
}

async function readEntryHoldLedger(fixture: StressFixture) {
  return prisma.ledgerTransaction.findMany({
    where: {
      type: LedgerTransactionType.ENTRY_HOLD,
      idempotencyKey: {
        startsWith: `${fixture.runId}:`,
      },
    },
    include: {
      entries: true,
    },
  });
}

async function expectCoreInvariants(
  fixture: StressFixture,
  expectedAcceptedAmount: bigint,
  options: { expectFinalizedRoundTotals?: boolean } = {},
) {
  const [round, entries, wallets, ledgerTransactions] = await Promise.all([
    prisma.round.findUniqueOrThrow({
      where: { id: fixture.roundId },
    }),
    prisma.entry.findMany({
      where: { roundId: fixture.roundId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    }),
    prisma.walletAccount.findMany({
      where: {
        userId: { in: fixture.userIds },
        type: WalletAccountType.MAIN,
      },
    }),
    readEntryHoldLedger(fixture),
  ]);

  const entryTotal = sumBigInts(entries.map((entry) => entry.amount));
  const debitEntries = ledgerTransactions.flatMap((transaction) =>
    transaction.entries.filter(
      (entry) => entry.direction === LedgerEntryDirection.DEBIT,
    ),
  );
  const debitTotal = sumBigInts(debitEntries.map((entry) => entry.amount));
  const idempotencyKeys = ledgerTransactions.map(
    (transaction) => transaction.idempotencyKey,
  );
  const entryKeys = entries.map((entry) => `${entry.roundId}:${entry.userId}`);

  if (options.expectFinalizedRoundTotals) {
    expect(round.totalEntryAmount).toBe(entryTotal);
    expect(round.payoutAmount).toBe(entryTotal);
  }
  expect(entryTotal).toBe(expectedAcceptedAmount);
  expect(debitTotal).toBe(expectedAcceptedAmount);
  expect(new Set(entryKeys).size).toBe(entryKeys.length);
  expect(new Set(idempotencyKeys).size).toBe(idempotencyKeys.length);
  expect(wallets.every((wallet) => wallet.balanceSnapshot >= 0n)).toBe(true);

  for (const transaction of ledgerTransactions) {
    expect(transaction.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          direction: LedgerEntryDirection.DEBIT,
        }),
      ]),
    );
  }

  return {
    round,
    entries,
    wallets,
    ledgerTransactions,
    debitEntries,
    entryTotal,
    debitTotal,
  };
}

describe('EntriesService concurrency stress', () => {
  beforeAll(async () => {
    loadDatabaseUrl();
    console.log(
      `[entry-stress-db] ${describeDatabaseUrl(process.env.DATABASE_URL)}`,
    );
    prisma = new PrismaService();
    await prisma.$connect();
    await logDatabaseDiagnostics('before-all');
    roundsService = new RoundsService(prisma, {} as never);
    entriesService = new EntriesService(prisma, roundsService);
  });

  afterEach(async () => {
    for (const runId of [...runIds]) {
      await cleanupRun(runId);
      runIds.delete(runId);
    }
  });

  afterAll(async () => {
    for (const summary of summaries) {
      console.log(
        `[entry-stress-summary] ${summary.name} requests=${summary.totalRequests} success=${summary.successCount} errors=${summary.errorCount} p95=${Math.round(summary.p95)}ms max=${Math.round(summary.max)}ms`,
      );
    }

    await prisma.$disconnect();
  });

  it('allows concurrent users to enter the same OPEN round without ledger drift', async () => {
    for (const users of getStressUserMatrix()) {
      const fixture = await createFixture({
        users,
        amount: 10,
        startingBalance: 100n,
      });

      const activityProbe =
        users >= 100
          ? new Promise<void>((resolve) => {
              setTimeout(() => {
                void logDatabaseDiagnostics(`${users}-users-during`).finally(
                  resolve,
                );
              }, 100);
            })
          : Promise.resolve();

      const results = await Promise.all(
        fixture.userIds.map((userId, index) =>
          placeEntry(
            fixture,
            userId,
            fixture.amount,
            `${fixture.runId}:entry:user-${index}`,
          ),
        ),
      );
      await activityProbe;

      if (users >= 100) {
        await logDatabaseDiagnostics(`${users}-users-after`);
      }

      summarize(`${users}-users-open-round`, results);

      const successes = successful(results);
      const errors = failed(results);

      expect(errors).toHaveLength(0);
      expect(successes).toHaveLength(fixture.userIds.length);

      const invariants = await expectCoreInvariants(
        fixture,
        BigInt(fixture.userIds.length * fixture.amount),
      );

      expect(invariants.entries).toHaveLength(fixture.userIds.length);
      expect(invariants.ledgerTransactions).toHaveLength(fixture.userIds.length);
      expect(invariants.debitEntries).toHaveLength(fixture.userIds.length);

      for (const wallet of invariants.wallets) {
        expect(wallet.balanceSnapshot).toBe(
          fixture.startingBalance - BigInt(fixture.amount),
        );
      }

      for (const userId of fixture.userIds) {
        expect(
          invariants.entries.filter((entry) => entry.userId === userId),
        ).toHaveLength(1);
      }

      const expectedTotal = BigInt(fixture.userIds.length * fixture.amount);
      const locked = await roundsService.lockCurrentRoundForRoom(fixture.roomId);

      expect(locked.currentRound.totalEntryAmount).toBe(
        expectedTotal.toString(),
      );
      expect(locked.currentRound.payoutAmount).toBe(expectedTotal.toString());

      const finalized = await expectCoreInvariants(fixture, expectedTotal, {
        expectFinalizedRoundTotals: true,
      });

      expect(
        finalized.entries.every((entry) => entry.ticketStart !== null),
      ).toBe(true);
      expect(finalized.entries.at(-1)?.ticketEnd).toBe(expectedTotal - 1n);

      await cleanupFixture(fixture);
      runIds.delete(fixture.runId);
    }
  });

  it('deduplicates 10 concurrent same-user clicks with the same idempotency key', async () => {
    const fixture = await createFixture({
      users: 1,
      amount: 10,
      startingBalance: 100n,
    });
    const idempotencyKey = `${fixture.runId}:entry:same-key`;

    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        placeEntry(fixture, fixture.userIds[0], fixture.amount, idempotencyKey),
      ),
    );

    summarize('same-user-same-key', results);

    expect(failed(results)).toHaveLength(0);
    expect(successful(results)).toHaveLength(10);

    const invariants = await expectCoreInvariants(fixture, 10n);
    const wallet = invariants.wallets[0];

    expect(invariants.entries).toHaveLength(1);
    expect(invariants.entries[0].amount).toBe(10n);
    expect(invariants.ledgerTransactions).toHaveLength(1);
    expect(wallet.balanceSnapshot).toBe(90n);
    expect(
      successful(results).filter((result) => result.value.reused).length,
    ).toBeGreaterThanOrEqual(1);

    await cleanupFixture(fixture);
    runIds.delete(fixture.runId);
  });

  it('accepts entries in the final two seconds while the round is still OPEN', async () => {
    const fixture = await createFixture({
      users: 1,
      amount: 10,
      startingBalance: 100n,
    });

    await prisma.round.update({
      where: { id: fixture.roundId },
      data: { locksAt: new Date(Date.now() + 1_500) },
    });

    const result = await placeEntry(
      fixture,
      fixture.userIds[0],
      fixture.amount,
      `${fixture.runId}:entry:final-two-seconds`,
    );

    summarize('final-two-seconds-open-entry', [result]);

    expect(result.ok).toBe(true);

    const invariants = await expectCoreInvariants(fixture, 10n);

    expect(invariants.entries).toHaveLength(1);
    expect(invariants.ledgerTransactions).toHaveLength(1);
    expect(invariants.wallets[0].balanceSnapshot).toBe(90n);

    await cleanupFixture(fixture);
    runIds.delete(fixture.runId);
  });

  it('rejects entries after locksAt even if the stale row is still OPEN', async () => {
    const fixture = await createFixture({
      users: 1,
      amount: 10,
      startingBalance: 100n,
    });

    await prisma.round.update({
      where: { id: fixture.roundId },
      data: { locksAt: new Date(Date.now() - 1_000) },
    });

    const result = await placeEntry(
      fixture,
      fixture.userIds[0],
      fixture.amount,
      `${fixture.runId}:entry:expired-open`,
    );

    summarize('expired-open-entry-rejected', [result]);

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.error).toBeInstanceOf(
      BadRequestException,
    );

    const invariants = await expectCoreInvariants(fixture, 0n);

    expect(invariants.entries).toHaveLength(0);
    expect(invariants.ledgerTransactions).toHaveLength(0);
    expect(invariants.wallets[0].balanceSnapshot).toBe(100n);

    await cleanupFixture(fixture);
    runIds.delete(fixture.runId);
  });

  it('applies 10 concurrent top-ups with different idempotency keys without lost updates', async () => {
    const fixture = await createFixture({
      users: 1,
      amount: 10,
      startingBalance: 1_000n,
    });

    const initial = await placeEntry(
      fixture,
      fixture.userIds[0],
      fixture.amount,
      `${fixture.runId}:entry:initial`,
    );

    expect(initial.ok).toBe(true);

    const topUps = await Promise.all(
      Array.from({ length: 10 }, (_value, index) =>
        placeEntry(
          fixture,
          fixture.userIds[0],
          fixture.amount,
          `${fixture.runId}:entry:top-up-${index}`,
        ),
      ),
    );

    summarize('same-user-top-ups', topUps);

    expect(failed(topUps)).toHaveLength(0);

    const invariants = await expectCoreInvariants(fixture, 110n);

    expect(invariants.entries).toHaveLength(1);
    expect(invariants.entries[0].amount).toBe(110n);
    expect(invariants.ledgerTransactions).toHaveLength(11);
    expect(invariants.wallets[0].balanceSnapshot).toBe(890n);

    await cleanupFixture(fixture);
    runIds.delete(fixture.runId);
  });

  it('rolls back partial writes when the round locks during concurrent entry attempts', async () => {
    const fixture = await createFixture({
      users: 40,
      amount: 10,
      startingBalance: 100n,
    });

    const attempts = fixture.userIds.map((userId, index) =>
      placeEntry(
        fixture,
        userId,
        fixture.amount,
        `${fixture.runId}:entry:lock-race-${index}`,
      ),
    );

    const lock = prisma.round.updateMany({
      where: {
        id: fixture.roundId,
        status: RoundStatus.OPEN,
      },
      data: {
        status: RoundStatus.LOCKED,
        lockedAt: new Date(),
      },
    });

    const results = await Promise.all([...attempts, lock.then(() => null)]);
    const entryResults = results.filter(
      (result): result is MeasuredResult<unknown> => result !== null,
    );

    summarize('round-lock-race', entryResults);

    const successes = successful(entryResults);
    const acceptedAmount = BigInt(successes.length * fixture.amount);
    const invariants = await expectCoreInvariants(fixture, acceptedAmount);

    expect(invariants.entries).toHaveLength(successes.length);
    expect(invariants.ledgerTransactions).toHaveLength(successes.length);

    for (const rejected of failed(entryResults)) {
      expect(rejected.error).toBeInstanceOf(BadRequestException);
    }

    await cleanupFixture(fixture);
    runIds.delete(fixture.runId);
  });

  it('keeps wallet non-negative and ledger exact when balance only covers one concurrent attempt', async () => {
    const fixture = await createFixture({
      users: 1,
      amount: 10,
      startingBalance: 10n,
    });

    const results = await Promise.all(
      Array.from({ length: 10 }, (_value, index) =>
        placeEntry(
          fixture,
          fixture.userIds[0],
          fixture.amount,
          `${fixture.runId}:entry:insufficient-${index}`,
        ),
      ),
    );

    summarize('insufficient-balance-concurrency', results);

    const successes = successful(results);

    expect(successes.length).toBeLessThanOrEqual(1);

    const acceptedAmount = BigInt(successes.length * fixture.amount);
    const invariants = await expectCoreInvariants(fixture, acceptedAmount);

    expect(invariants.entries).toHaveLength(successes.length);
    expect(invariants.ledgerTransactions).toHaveLength(successes.length);
    expect(invariants.wallets[0].balanceSnapshot).toBe(10n - acceptedAmount);
    expect(invariants.wallets[0].balanceSnapshot).toBeGreaterThanOrEqual(0n);

    await cleanupFixture(fixture);
    runIds.delete(fixture.runId);
  });

  it('rejects a reused idempotency key with a different amount without a second debit', async () => {
    const fixture = await createFixture({
      users: 1,
      amount: 10,
      startingBalance: 100n,
    });
    const idempotencyKey = `${fixture.runId}:entry:mismatch`;

    const first = await placeEntry(
      fixture,
      fixture.userIds[0],
      fixture.amount,
      idempotencyKey,
    );
    const second = await placeEntry(
      fixture,
      fixture.userIds[0],
      fixture.amount * 2,
      idempotencyKey,
    );

    summarize('idempotency-mismatch', [first, second]);

    expect(first.ok).toBe(true);
    expect(second.ok).toBe(false);
    expect(second.ok === false && second.error).toBeInstanceOf(
      BadRequestException,
    );

    const invariants = await expectCoreInvariants(fixture, 10n);

    expect(invariants.entries).toHaveLength(1);
    expect(invariants.ledgerTransactions).toHaveLength(1);
    expect(invariants.wallets[0].balanceSnapshot).toBe(90n);

    await cleanupFixture(fixture);
    runIds.delete(fixture.runId);
  });
});
