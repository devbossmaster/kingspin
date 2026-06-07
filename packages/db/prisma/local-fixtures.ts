import { createHash, randomBytes, scrypt } from "node:crypto";
import {
  AdminAuditAction,
  DepositStatus,
  LedgerEntryDirection,
  LedgerTransactionType,
  PaymentProvider,
  Prisma,
  PrismaClient,
  RiskEventSeverity,
  RiskEventStatus,
  RiskEventType,
  Role,
  VerificationAttemptStatus,
  WalletAccountType,
  WithdrawalStatus,
} from "@prisma/client";

const LOCAL_ADMIN = {
  id: "phase11-local-admin",
  accountId: "phase11-local-admin-account",
  email: "admin.phase11@example.com",
  username: "phase11_admin",
  fullName: "Phase 11 Local Admin",
  phoneNumber: "+251911000001",
  password: "LocalAdmin1!",
  role: Role.ADMIN,
};

const LOCAL_PLAYER = {
  id: "phase11-local-player",
  accountId: "phase11-local-player-account",
  email: "player.phase11@example.com",
  username: "phase11_player",
  fullName: "Phase 11 Local Player",
  phoneNumber: "+251911000002",
  password: "LocalPlayer1!",
  role: Role.PLAYER,
};

const LOCAL_PLAYER_TWO = {
  id: "phase11-local-player-two",
  accountId: "phase11-local-player-two-account",
  email: "player2.phase11@example.com",
  username: "phase11_player2",
  fullName: "Phase 11 Local Player Two",
  phoneNumber: "+251911000003",
  password: "LocalPlayer2!",
  role: Role.PLAYER,
};

type LocalUserSeed = typeof LOCAL_ADMIN | typeof LOCAL_PLAYER;

export async function seedLocalFixtures(prisma: PrismaClient) {
  if (!isExplicitLocalFixtureTarget()) {
    console.log(
      "Skipped local admin/payment fixtures because the database target is not explicitly local and disposable.",
    );
    return;
  }

  const admin = await upsertLocalUser(prisma, LOCAL_ADMIN);
  const player = await upsertLocalUser(prisma, LOCAL_PLAYER);
  await upsertLocalUser(prisma, LOCAL_PLAYER_TWO);

  const playerWallet = await prisma.walletAccount.upsert({
    where: {
      userId_type: {
        userId: player.id,
        type: WalletAccountType.MAIN,
      },
    },
    update: {},
    create: {
      id: "phase11-local-player-wallet",
      userId: player.id,
      type: WalletAccountType.MAIN,
    },
  });

  await prisma.walletAccount.upsert({
    where: {
      userId_type: {
        userId: admin.id,
        type: WalletAccountType.MAIN,
      },
    },
    update: {},
    create: {
      id: "phase11-local-admin-wallet",
      userId: admin.id,
      type: WalletAccountType.MAIN,
    },
  });

  await ensureWalletMutation(prisma, {
    walletAccountId: playerWallet.id,
    direction: LedgerEntryDirection.CREDIT,
    amount: 2_000n,
    type: LedgerTransactionType.ADMIN_CREDIT,
    referenceType: "LOCAL_FIXTURE",
    referenceId: player.id,
    idempotencyKey: "phase11:fixture:player-credit",
    metadata: {
      source: "PHASE_11_LOCAL_FIXTURE",
      userId: player.id,
      walletAccountId: playerWallet.id,
      amount: "2000",
      reason: "Local smoke-test wallet credit",
    },
  });

  await prisma.adminAuditLog.upsert({
    where: { id: "phase11-audit-player-credit" },
    update: {},
    create: {
      id: "phase11-audit-player-credit",
      actorId: admin.id,
      action: AdminAuditAction.ADMIN_CREDIT,
      targetType: "WALLET",
      targetId: playerWallet.id,
      metadata: {
        source: "PHASE_11_LOCAL_FIXTURE",
        amount: "2000",
        reason: "Local smoke-test wallet credit",
      },
    },
  });

  await seedDepositFixtures(prisma, player.id, playerWallet.id);
  await seedWithdrawalFixtures(prisma, admin.id, player.id, playerWallet.id);
  await seedRiskAndAuditFixtures(prisma, admin.id, player.id);

  console.log("Seeded local-only Better Auth admin and player accounts.");
  console.log("Seeded local-only deposit, withdrawal, audit, and risk fixtures.");
}

function isExplicitLocalFixtureTarget() {
  if (
    process.env.APP_ENV !== "local" ||
    process.env.NODE_ENV === "production" ||
    !process.env.DATABASE_URL
  ) {
    return false;
  }

  try {
    const url = new URL(process.env.DATABASE_URL);
    const localHosts = new Set([
      "localhost",
      "127.0.0.1",
      "::1",
      "[::1]",
      "host.docker.internal",
    ]);
    const databaseName = url.pathname.replace(/^\/+/, "").toLowerCase();

    return (
      localHosts.has(url.hostname.toLowerCase()) &&
      /(local|test|dev|phase11)/.test(databaseName)
    );
  } catch {
    return false;
  }
}

async function upsertLocalUser(
  prisma: PrismaClient,
  fixture: LocalUserSeed,
) {
  const now = new Date();
  const password = await hashPassword(fixture.password);
  const user = await prisma.user.upsert({
    where: { id: fixture.id },
    update: {
      email: fixture.email,
      username: fixture.username,
      displayUsername: fixture.username,
      fullName: fixture.fullName,
      phoneNumber: fixture.phoneNumber,
      emailVerified: true,
      role: fixture.role,
      bannedAt: null,
    },
    create: {
      id: fixture.id,
      email: fixture.email,
      username: fixture.username,
      displayUsername: fixture.username,
      fullName: fixture.fullName,
      phoneNumber: fixture.phoneNumber,
      emailVerified: true,
      role: fixture.role,
    },
  });

  await prisma.account.upsert({
    where: { id: fixture.accountId },
    update: {
      accountId: user.id,
      providerId: "credential",
      password,
      updatedAt: now,
    },
    create: {
      id: fixture.accountId,
      accountId: user.id,
      providerId: "credential",
      userId: user.id,
      password,
      createdAt: now,
      updatedAt: now,
    },
  });

  return user;
}

async function hashPassword(password: string) {
  const salt = randomBytes(16).toString("hex");
  const key = await new Promise<Buffer>((resolve, reject) => {
    scrypt(
      password.normalize("NFKC"),
      salt,
      64,
      {
        N: 16_384,
        r: 16,
        p: 1,
        maxmem: 128 * 16_384 * 16 * 2,
      },
      (error, derivedKey) => {
        if (error) {
          reject(error);
        } else {
          resolve(derivedKey);
        }
      },
    );
  });

  return `${salt}:${key.toString("hex")}`;
}

async function seedDepositFixtures(
  prisma: PrismaClient,
  userId: string,
  walletAccountId: string,
) {
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1_000);
  const reviewFixtures = [
    {
      id: "phase11-deposit-review-approve",
      receiptNo: "LOCALREVIEW001",
      amount: new Prisma.Decimal("125.00"),
      reason: "Local fixture requires manual receiver confirmation.",
    },
    {
      id: "phase11-deposit-review-reject",
      receiptNo: "LOCALREVIEW002",
      amount: new Prisma.Decimal("130.00"),
      reason: "Local fixture requires manual payer confirmation.",
    },
  ];

  for (const fixture of reviewFixtures) {
    await prisma.depositIntent.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        userId,
        provider: PaymentProvider.TELEBIRR_RECEIPT,
        status: DepositStatus.NEEDS_MANUAL_REVIEW,
        expectedAmount: fixture.amount,
        currency: "ETB",
        receiverName: "KingSpin Local Test Receiver",
        receiverAccount: "LOCAL-TEST-ACCOUNT",
        receiverShortCode: "LOCALTEST",
        providerRef: fixture.receiptNo,
        receiptNo: fixture.receiptNo,
        idempotencyKey: `phase11:fixture:${fixture.id}`,
        reviewReason: fixture.reason,
        rawProviderHash: fixtureHash(fixture.id),
        verifiedAt: new Date(),
        expiresAt,
      },
    });

    await prisma.paymentVerificationAttempt.upsert({
      where: { id: `${fixture.id}-attempt` },
      update: {},
      create: {
        id: `${fixture.id}-attempt`,
        depositIntentId: fixture.id,
        provider: PaymentProvider.TELEBIRR_RECEIPT,
        submittedValue: fixture.receiptNo,
        normalizedRef: fixture.receiptNo,
        status: VerificationAttemptStatus.NEEDS_MANUAL_REVIEW,
        reason: fixture.reason,
        httpStatus: 200,
        providerStatus: "LOCAL_TEST_REVIEW",
        parsedAmount: fixture.amount,
        parsedCurrency: "ETB",
        parsedReceiver: "KingSpin Local Test Receiver",
        parsedPayer: "+251911***002",
        parsedPaidAt: new Date(),
        rawProviderHash: fixtureHash(`${fixture.id}:attempt`),
      },
    });
  }

  const creditedId = "phase11-deposit-credited";
  await prisma.depositIntent.upsert({
    where: { id: creditedId },
    update: {},
    create: {
      id: creditedId,
      userId,
      provider: PaymentProvider.TELEBIRR_RECEIPT,
      status: DepositStatus.PENDING,
      expectedAmount: new Prisma.Decimal("200.00"),
      currency: "ETB",
      receiverName: "KingSpin Local Test Receiver",
      receiverAccount: "LOCAL-TEST-ACCOUNT",
      receiverShortCode: "LOCALTEST",
      providerRef: "LOCALCREDIT001",
      receiptNo: "LOCALCREDIT001",
      idempotencyKey: "phase11:fixture:deposit-credited",
      rawProviderHash: fixtureHash(creditedId),
      verifiedAt: new Date(),
      expiresAt,
    },
  });

  const credit = await ensureWalletMutation(prisma, {
    walletAccountId,
    direction: LedgerEntryDirection.CREDIT,
    amount: 200n,
    type: LedgerTransactionType.DEPOSIT,
    referenceType: "DEPOSIT",
    referenceId: creditedId,
    idempotencyKey: "deposit:telebirr-receipt:LOCALCREDIT001",
    metadata: {
      source: "PHASE_11_LOCAL_FIXTURE",
      userId,
      depositId: creditedId,
      amount: "200",
      currency: "ETB",
      provider: PaymentProvider.TELEBIRR_RECEIPT,
      walletAccountId,
    },
  });

  await prisma.depositIntent.update({
    where: { id: creditedId },
    data: {
      status: DepositStatus.CREDITED,
      creditedAt: new Date(),
      creditedWalletEntryId: credit.ledgerEntryId,
    },
  });

  await prisma.paymentVerificationAttempt.upsert({
    where: { id: `${creditedId}-attempt` },
    update: {},
    create: {
      id: `${creditedId}-attempt`,
      depositIntentId: creditedId,
      provider: PaymentProvider.TELEBIRR_RECEIPT,
      submittedValue: "LOCALCREDIT001",
      normalizedRef: "LOCALCREDIT001",
      status: VerificationAttemptStatus.ACCEPTED,
      reason: "Local fixture receipt accepted.",
      httpStatus: 200,
      providerStatus: "LOCAL_TEST_ACCEPTED",
      parsedAmount: new Prisma.Decimal("200.00"),
      parsedCurrency: "ETB",
      parsedReceiver: "KingSpin Local Test Receiver",
      parsedPayer: "+251911***002",
      parsedPaidAt: new Date(),
      rawProviderHash: fixtureHash(`${creditedId}:attempt`),
    },
  });

  await prisma.deposit.upsert({
    where: { id: "phase11-manual-deposit-pending" },
    update: {},
    create: {
      id: "phase11-manual-deposit-pending",
      userId,
      provider: PaymentProvider.MOCK,
      providerReference: "LOCAL-MOCK-PENDING-001",
      amount: 90n,
      currency: "COIN",
      status: DepositStatus.PENDING,
      idempotencyKey: "phase11:fixture:manual-deposit-pending",
      metadata: {
        source: "PHASE_11_LOCAL_FIXTURE",
        note: "Safe local pending deposit fixture",
      },
    },
  });
}

async function seedWithdrawalFixtures(
  prisma: PrismaClient,
  adminId: string,
  userId: string,
  walletAccountId: string,
) {
  const pendingFixtures = [
    {
      id: "phase11-withdrawal-complete",
      amount: 100n,
      idempotencyKey: "phase11:fixture:withdrawal-complete",
    },
    {
      id: "phase11-withdrawal-reject",
      amount: 80n,
      idempotencyKey: "phase11:fixture:withdrawal-reject",
    },
  ];

  for (const fixture of pendingFixtures) {
    await prisma.withdrawal.upsert({
      where: { id: fixture.id },
      update: {},
      create: {
        id: fixture.id,
        userId,
        walletAccountId,
        provider: PaymentProvider.MANUAL,
        amount: fixture.amount,
        currency: "COIN",
        destination: {
          type: "PHONE",
          phoneNumber: "+251911000002",
          source: "PHASE_11_LOCAL_FIXTURE",
        },
        status: WithdrawalStatus.PENDING_REVIEW,
        idempotencyKey: fixture.idempotencyKey,
        metadata: { source: "PHASE_11_LOCAL_FIXTURE" },
      },
    });

    await ensureWalletMutation(prisma, {
      walletAccountId,
      direction: LedgerEntryDirection.DEBIT,
      amount: fixture.amount,
      type: LedgerTransactionType.WITHDRAWAL_REQUEST,
      referenceType: "WITHDRAWAL",
      referenceId: fixture.id,
      idempotencyKey: `withdrawal-reserve:${fixture.id}`,
      metadata: {
        source: "PHASE_11_LOCAL_FIXTURE",
        userId,
        withdrawalId: fixture.id,
        amount: fixture.amount.toString(),
        currency: "COIN",
        provider: PaymentProvider.MANUAL,
        walletAccountId,
        reserveState: "RESERVED",
      },
    });
  }

  const completedId = "phase11-withdrawal-completed";
  await prisma.withdrawal.upsert({
    where: { id: completedId },
    update: {},
    create: {
      id: completedId,
      userId,
      walletAccountId,
      provider: PaymentProvider.MANUAL,
      amount: 75n,
      currency: "COIN",
      destination: {
        type: "PHONE",
        phoneNumber: "+251911000002",
        source: "PHASE_11_LOCAL_FIXTURE",
      },
      status: WithdrawalStatus.PAID,
      providerReference: "LOCAL-WITHDRAWAL-PAID-001",
      reviewedAt: new Date(),
      reviewedByAdminId: adminId,
      paidAt: new Date(),
      idempotencyKey: "phase11:fixture:withdrawal-completed",
      metadata: { source: "PHASE_11_LOCAL_FIXTURE" },
    },
  });

  await ensureWalletMutation(prisma, {
    walletAccountId,
    direction: LedgerEntryDirection.DEBIT,
    amount: 75n,
    type: LedgerTransactionType.WITHDRAWAL_REQUEST,
    referenceType: "WITHDRAWAL",
    referenceId: completedId,
    idempotencyKey: `withdrawal-reserve:${completedId}`,
    metadata: {
      source: "PHASE_11_LOCAL_FIXTURE",
      userId,
      withdrawalId: completedId,
      amount: "75",
      currency: "COIN",
      provider: PaymentProvider.MANUAL,
      walletAccountId,
      reserveState: "RESERVED",
    },
  });

  const rejectedId = "phase11-withdrawal-rejected";
  await prisma.withdrawal.upsert({
    where: { id: rejectedId },
    update: {},
    create: {
      id: rejectedId,
      userId,
      walletAccountId,
      provider: PaymentProvider.MANUAL,
      amount: 60n,
      currency: "COIN",
      destination: {
        type: "PHONE",
        phoneNumber: "+251911000002",
        source: "PHASE_11_LOCAL_FIXTURE",
      },
      status: WithdrawalStatus.REJECTED,
      reviewedAt: new Date(),
      reviewedByAdminId: adminId,
      rejectionReason: "Local fixture rejection",
      idempotencyKey: "phase11:fixture:withdrawal-rejected",
      metadata: { source: "PHASE_11_LOCAL_FIXTURE" },
    },
  });

  await ensureWalletMutation(prisma, {
    walletAccountId,
    direction: LedgerEntryDirection.DEBIT,
    amount: 60n,
    type: LedgerTransactionType.WITHDRAWAL_REQUEST,
    referenceType: "WITHDRAWAL",
    referenceId: rejectedId,
    idempotencyKey: `withdrawal-reserve:${rejectedId}`,
    metadata: {
      source: "PHASE_11_LOCAL_FIXTURE",
      userId,
      withdrawalId: rejectedId,
      amount: "60",
      currency: "COIN",
      provider: PaymentProvider.MANUAL,
      walletAccountId,
      reserveState: "RESERVED",
    },
  });
  await ensureWalletMutation(prisma, {
    walletAccountId,
    direction: LedgerEntryDirection.CREDIT,
    amount: 60n,
    type: LedgerTransactionType.WITHDRAWAL_REFUND,
    referenceType: "WITHDRAWAL",
    referenceId: rejectedId,
    idempotencyKey: `withdrawal-refund:${rejectedId}`,
    metadata: {
      source: "PHASE_11_LOCAL_FIXTURE",
      userId,
      withdrawalId: rejectedId,
      amount: "60",
      currency: "COIN",
      provider: PaymentProvider.MANUAL,
      walletAccountId,
      reason: "Local fixture rejection",
    },
  });

  await prisma.adminAuditLog.upsert({
    where: { id: "phase11-audit-withdrawal-completed" },
    update: {},
    create: {
      id: "phase11-audit-withdrawal-completed",
      actorId: adminId,
      action: AdminAuditAction.WITHDRAWAL_COMPLETED,
      targetType: "WITHDRAWAL",
      targetId: completedId,
      metadata: {
        source: "PHASE_11_LOCAL_FIXTURE",
        externalReference: "LOCAL-WITHDRAWAL-PAID-001",
      },
    },
  });
}

async function seedRiskAndAuditFixtures(
  prisma: PrismaClient,
  adminId: string,
  userId: string,
) {
  await prisma.riskEvent.upsert({
    where: { id: "phase11-risk-local-review" },
    update: {},
    create: {
      id: "phase11-risk-local-review",
      userId,
      type: RiskEventType.MANUAL_FLAG,
      severity: RiskEventSeverity.MEDIUM,
      status: RiskEventStatus.OPEN,
      metadata: {
        source: "PHASE_11_LOCAL_FIXTURE",
        reason: "Local risk page smoke-test fixture",
      },
    },
  });

  await prisma.adminAuditLog.upsert({
    where: { id: "phase11-audit-room-review" },
    update: {},
    create: {
      id: "phase11-audit-room-review",
      actorId: adminId,
      action: AdminAuditAction.ROOM_CONFIGURED,
      targetType: "ROOM",
      metadata: {
        source: "PHASE_11_LOCAL_FIXTURE",
        note: "Local admin audit page fixture",
      },
    },
  });
}

async function ensureWalletMutation(
  prisma: PrismaClient,
  args: {
    walletAccountId: string;
    direction: LedgerEntryDirection;
    amount: bigint;
    type: LedgerTransactionType;
    referenceType: string;
    referenceId: string;
    idempotencyKey: string;
    metadata: Prisma.InputJsonObject;
  },
) {
  return prisma.$transaction(async (tx) => {
    const existing = await tx.ledgerTransaction.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
      include: { entries: true },
    });

    if (existing) {
      return {
        ledgerEntryId: existing.entries[0]?.id ?? null,
      };
    }

    const wallet = await tx.walletAccount.update({
      where: { id: args.walletAccountId },
      data: {
        balanceSnapshot:
          args.direction === LedgerEntryDirection.CREDIT
            ? { increment: args.amount }
            : { decrement: args.amount },
      },
    });
    const transaction = await tx.ledgerTransaction.create({
      data: {
        type: args.type,
        referenceType: args.referenceType,
        referenceId: args.referenceId,
        idempotencyKey: args.idempotencyKey,
        metadata: args.metadata,
        entries: {
          create: {
            walletAccountId: args.walletAccountId,
            direction: args.direction,
            amount: args.amount,
            balanceAfterSnapshot: wallet.balanceSnapshot,
          },
        },
      },
      include: { entries: true },
    });

    return {
      ledgerEntryId: transaction.entries[0]?.id ?? null,
    };
  });
}

function fixtureHash(value: string) {
  return createHash("sha256").update(`phase11-local:${value}`).digest("hex");
}
