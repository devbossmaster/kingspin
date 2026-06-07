import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  Optional,
} from '@nestjs/common';
import {
  GameMode,
  LedgerTransactionType,
  LedgerEntryDirection,
  Prisma,
  RoomStatus,
  RoundStatus,
  WalletAccountType,
  type Entry,
  type Round,
  type User,
} from '@kingspin/db';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { FraudService } from '../fraud/fraud.service';
import { RoundsService } from '../rounds/rounds.service';
import { WalletsService } from '../wallets/wallets.service';

export type PlaceEntryBody = {
  amount?: unknown;
  idempotencyKey?: unknown;
};

export type PlaceEntryForUserArgs = {
  roomId: string;
  userId: string;
  amount: unknown;
  idempotencyKey?: unknown;
  requestId?: string;
  requestReceivedAtMs?: number;
  ipAddress?: string | null;
  userAgent?: string | null;
  deviceId?: string | null;
};

type EntrySnapshot = {
  id: string;
  roundId: string;
  userId: string;
  amount: string;
  ticketStart: string | null;
  ticketEnd: string | null;
  isWinner: boolean;
  createdAt: string;
  updatedAt: string;
};

type PlayerSnapshotSource = Pick<
  User,
  'id' | 'username' | 'email' | 'fullName'
>;

type EntryPlacementStatus =
  | 'SUCCESS'
  | 'REPLAY'
  | 'USER_NOT_FOUND'
  | 'ROOM_NOT_FOUND'
  | 'ROOM_NOT_ACTIVE'
  | 'CATEGORY_INACTIVE'
  | 'ENTRY_CONFIG_MISSING'
  | 'WALLET_NOT_FOUND'
  | 'IDEMPOTENCY_MISMATCH'
  | 'IDEMPOTENCY_REPLAY_MISSING'
  | 'ENTRY_HELD_MISMATCH'
  | 'ENTRY_BELOW_MIN'
  | 'ENTRY_ABOVE_MAX'
  | 'ENTRY_EXCEEDS_MAX'
  | 'FIXED_ENTRY_AMOUNT_REQUIRED'
  | 'FIXED_ENTRY_AMOUNT_MISMATCH'
  | 'FIXED_TOP_UP_NOT_ALLOWED'
  | 'INSUFFICIENT_BALANCE'
  | 'ROUND_NOT_OPEN'
  | 'IDEMPOTENCY_RACE'
  | 'LEDGER_WRITE_FAILED'
  | 'UNKNOWN';

type EntryPlacementRow = {
  status: EntryPlacementStatus;
  reused: boolean;
  existingEntryAmount: bigint | null;
  walletBalanceSnapshot: bigint | null;
  gameMode: GameMode | null;
  categoryMinEntryAmount: bigint | null;
  categoryMaxEntryAmount: bigint | null;
  userId: string | null;
  userEmail: string | null;
  userUsername: string | null;
  userFullName: string | null;
  entryId: string | null;
  entryRoundId: string | null;
  entryUserId: string | null;
  entryAmount: bigint | null;
  entryTicketStart: bigint | null;
  entryTicketEnd: bigint | null;
  entryIsWinner: boolean | null;
  entryCreatedAt: Date | null;
  entryUpdatedAt: Date | null;
  walletId: string | null;
  walletUserId: string | null;
  walletType: string | null;
  walletCreatedAt: Date | null;
  walletUpdatedAt: Date | null;
  roundId: string | null;
  roundRoomId: string | null;
  roundNumber: number | null;
  roundStatus: RoundStatus | null;
  roundOpenedAt: Date | null;
  roundLocksAt: Date | null;
  roundLockedAt: Date | null;
  roundDrawingAt: Date | null;
  roundSpinningAt: Date | null;
  roundSettlingAt: Date | null;
  roundCompletedAt: Date | null;
  roundCancelledAt: Date | null;
  roundTotalEntryAmount: bigint | null;
  roundHouseFeeAmount: bigint | null;
  roundPayoutAmount: bigint | null;
  roundServerSeedHash: string | null;
  roundServerSeedReveal: string | null;
  roundWinningTicket: bigint | null;
  roundWinnerUserId: string | null;
  roundWinnerEntryId: string | null;
  roundSpinAngle: number | null;
  roundIdempotencyKey: string | null;
  roundCreatedAt: Date | null;
  roundUpdatedAt: Date | null;
};

const ENTRY_TIMING_WARN_THRESHOLD_MS = 300;

class EntryIdempotencyRaceError extends Error {
  constructor() {
    super('Entry idempotency key raced with another request.');
    this.name = 'EntryIdempotencyRaceError';
  }
}

@Injectable()
export class EntriesService {
  private readonly logger = new Logger(EntriesService.name);

  private readonly transactionOptions = {
    maxWait: 30_000,
    timeout: 20_000,
  } as const;

  constructor(
    private readonly prisma: PrismaService,
    private readonly roundsService: RoundsService,
    @Optional() private readonly fraudService?: FraudService,
  ) {}

  async placeEntryForUser(args: PlaceEntryForUserArgs) {
    if (!args.roomId) {
      throw new BadRequestException('roomId is required.');
    }

    if (!args.userId) {
      throw new BadRequestException('Authenticated user id is required.');
    }

    return this.placeEntryForResolvedUserId(
      args.roomId,
      {
        amount: args.amount,
        idempotencyKey: args.idempotencyKey,
      },
      args.userId,
      'entry',
      {
        requestId: args.requestId,
        requestReceivedAtMs: args.requestReceivedAtMs,
        ipAddress: args.ipAddress,
        userAgent: args.userAgent,
        deviceId: args.deviceId,
      },
    );
  }

  private async placeEntryForResolvedUserId(
    roomId: string,
    body: PlaceEntryBody,
    userId: string,
    idempotencyScope: 'entry',
    telemetry?: {
      requestId?: string;
      requestReceivedAtMs?: number;
      ipAddress?: string | null;
      userAgent?: string | null;
      deviceId?: string | null;
    },
  ) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const requestAcceptedAt = new Date();
    const traceId = `${roomId}:${this.hashUserId(userId)}:${Date.now().toString(36)}`;
    const startedAt = Date.now();
    let previousAt = startedAt;
    let timingFlushed = false;
    let placementStatus: EntryPlacementStatus | 'ERROR' | null = null;
    let placementRoundId: string | null = null;
    let placementGameMode: GameMode | null = null;
    const timingEvents: {
      prefix: 'entry-timing' | 'wallet-hold-timing';
      message: string;
    }[] = [];

    const recordTiming = (
      prefix: 'entry-timing' | 'wallet-hold-timing',
      message: string,
    ) => {
      timingEvents.push({ prefix, message });
    };

    const flushTimingIfSlow = () => {
      const totalMs = Date.now() - startedAt;

      if (timingFlushed || totalMs < ENTRY_TIMING_WARN_THRESHOLD_MS) {
        return;
      }

      timingFlushed = true;

      const events = timingEvents
        .map((event) => `${event.prefix} ${event.message}`)
        .join('; ');

      this.logger.warn(
        `[entry-timing:${traceId}] slow entry placement requestId=${telemetry?.requestId ?? 'none'} roomId=${roomId} roundId=${placementRoundId ?? 'unknown'} user=${this.hashUserId(userId)} amount=${String(body?.amount ?? 'unknown')} gameMode=${placementGameMode ?? 'unknown'} status=${placementStatus ?? 'unknown'} total=${totalMs}ms events=${events}`,
      );
    };

    const mark = (label: string) => {
      const now = Date.now();
      const stepMs = now - previousAt;
      const totalMs = now - startedAt;
      previousAt = now;

      recordTiming(
        'entry-timing',
        `${label} step=${stepMs}ms total=${totalMs}ms`,
      );
    };

    if (telemetry?.requestReceivedAtMs) {
      recordTiming(
        'entry-timing',
        `request received to service start duration=${Math.max(0, startedAt - telemetry.requestReceivedAtMs)}ms`,
      );
    }

    const addAmount = this.parseAmount(body?.amount);

    const requestIdempotencyKey =
      typeof body?.idempotencyKey === 'string' &&
      body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim()
        : `${idempotencyScope}:${roomId}:${userId}:${randomUUID()}`;

    mark('input validation and idempotency normalization');

    const fraudStartedAt = Date.now();
    await this.assertFraudAllowed({
      roomId,
      userId,
      amount: addAmount,
      requestId: telemetry?.requestId,
      requestAcceptedAt,
    });
    recordTiming(
      'entry-timing',
      `fraud preflight duration=${Date.now() - fraudStartedAt}ms`,
    );

    const entryId = randomUUID();

    try {
      mark('before atomic placement transaction');

      const transactionStartedAt = Date.now();
      const result = await this.prisma.$transaction(async (tx) => {
        const operationStartedAt = Date.now();
        recordTiming(
          'entry-timing',
          `transaction wait/start duration=${operationStartedAt - transactionStartedAt}ms`,
        );
        const placement = await this.writeEntryPlacementInTransaction(tx, {
          roomId,
          userId,
          amount: addAmount,
          idempotencyKey: requestIdempotencyKey,
          requestAcceptedAt,
          entryId,
          ledgerTransactionId: randomUUID(),
          ledgerEntryId: randomUUID(),
          observeStatus: (row) => {
            placementStatus = row.status;
            placementRoundId = row.roundId;
            placementGameMode = row.gameMode;
          },
        });

        const durationMs = Date.now() - operationStartedAt;
        recordTiming(
          'wallet-hold-timing',
          `atomic SQL execution duration=${durationMs}ms`,
        );
        mark('tx compact placement write');

        return placement;
      }, this.transactionOptions);

      recordTiming(
        'entry-timing',
        `atomic transaction duration=${Date.now() - transactionStartedAt}ms`,
      );
      mark('transaction complete');

      const responseStartedAt = Date.now();
      const response = {
        entry: this.toEntrySnapshot(result.entry),
        player: this.toPlayerSnapshot(result.player),
        wallet: result.wallet,
        currentRound: this.roundsService.toLiveRoundSnapshot(result.round),
        reused: result.reused,
      };
      recordTiming(
        'entry-timing',
        `post-commit response shaping duration=${Date.now() - responseStartedAt}ms`,
      );

      if (!result.reused) {
        void this.fraudService
          ?.evaluateEntryPlacement({
            roomId,
            userId,
            entryId: result.entry.id,
            roundId: result.entry.roundId,
            amount: addAmount,
            requestId: telemetry?.requestId,
            ipAddress: telemetry?.ipAddress,
            userAgent: telemetry?.userAgent,
            deviceId: telemetry?.deviceId,
          })
          .catch((error: unknown) => {
            this.logger.warn(
              `Entry risk scoring failed after placement: ${
                error instanceof Error ? error.message : String(error)
              }`,
            );
          });
      }

      flushTimingIfSlow();

      return response;
    } catch (error) {
      placementStatus ??= 'ERROR';
      mark('failed before throw');
      flushTimingIfSlow();
      /**
       * If a duplicate idempotency key wins a race, try to replay the completed
       * placement instead of failing the user's click.
       */
      if (this.isUniqueConstraintError(error)) {
        const replayInspection =
          await this.inspectExistingPlacementSnapshotByIdempotencyKey({
            idempotencyKey: requestIdempotencyKey,
            amount: addAmount,
          });

        if (replayInspection.placement) {
          return replayInspection.placement;
        }

        throw new BadRequestException(
          'Duplicate entry request detected. Use a new idempotency key and retry safely.',
        );
      }

      if (error instanceof EntryIdempotencyRaceError) {
        const replayInspection =
          await this.inspectExistingPlacementSnapshotByIdempotencyKey({
            idempotencyKey: requestIdempotencyKey,
            amount: addAmount,
          });

        if (replayInspection.placement) {
          return replayInspection.placement;
        }

        throw new BadRequestException(
          'Duplicate entry request detected. Use a new idempotency key and retry safely.',
        );
      }

      throw error;
    }
  }

  private async writeEntryPlacementInTransaction(
    tx: Prisma.TransactionClient,
    args: {
      roomId: string;
      userId: string;
      amount: bigint;
      idempotencyKey: string;
      requestAcceptedAt: Date;
      entryId: string;
      ledgerTransactionId: string;
      ledgerEntryId: string;
      observeStatus?: (row: EntryPlacementRow) => void;
    },
  ) {
    const rows = await tx.$queryRaw<EntryPlacementRow[]>(Prisma.sql`
      WITH input AS (
        SELECT
          ${args.userId}::text AS user_id,
          ${args.roomId}::text AS room_id,
          ${args.amount}::bigint AS amount,
          ${args.idempotencyKey}::text AS idempotency_key,
          (${args.requestAcceptedAt}::timestamptz AT TIME ZONE 'UTC')::timestamp(3) AS request_accepted_at,
          ${args.entryId}::text AS new_entry_id,
          ${args.ledgerTransactionId}::text AS ledger_transaction_id,
          ${args.ledgerEntryId}::text AS ledger_entry_id
      ),
      selected_user AS (
        SELECT
          u.id,
          u.email,
          u.username,
          u."fullName"
        FROM users u
        JOIN input i ON u.id = i.user_id
        LIMIT 1
      ),
      selected_room AS (
        SELECT r.*
        FROM rooms r
        JOIN input i ON r.id = i.room_id
        LIMIT 1
      ),
      selected_category AS (
        SELECT c.*
        FROM categories c
        JOIN selected_room r ON c.id = r."categoryId"
        LIMIT 1
      ),
      open_round_candidate AS (
        SELECT r.*
        FROM rounds r
        JOIN input i ON r."roomId" = i.room_id
        WHERE r.status = CAST(${RoundStatus.OPEN} AS "RoundStatus")
          AND (r."locksAt" IS NULL OR r."locksAt" > i.request_accepted_at)
        ORDER BY r."roundNumber" DESC
        LIMIT 1
      ),
      round_gate AS (
        SELECT pg_advisory_xact_lock_shared(hashtext(candidate.id)::bigint)
        FROM open_round_candidate candidate
      ),
      current_open_round AS (
        SELECT r.*
        FROM rounds r
        JOIN open_round_candidate candidate ON r.id = candidate.id
        CROSS JOIN round_gate
        CROSS JOIN input i
        WHERE r.status = CAST(${RoundStatus.OPEN} AS "RoundStatus")
          AND (r."locksAt" IS NULL OR r."locksAt" > i.request_accepted_at)
        LIMIT 1
      ),
      current_wallet AS (
        SELECT w.*
        FROM wallet_accounts w
        JOIN input i ON w."userId" = i.user_id
        WHERE w.type = CAST(${WalletAccountType.MAIN} AS "WalletAccountType")
        LIMIT 1
      ),
      entry_config AS (
        SELECT
          selected_room.status AS room_status,
          selected_room."gameMode" AS game_mode,
          selected_room."fixedEntryAmount" AS fixed_entry_amount,
          selected_category."isActive" AS category_is_active,
          selected_category."minEntryAmount" AS min_entry_amount,
          selected_category."maxEntryAmount" AS max_entry_amount
        FROM input i
        LEFT JOIN selected_room ON true
        LEFT JOIN selected_category ON true
        LIMIT 1
      ),
      existing_transaction AS (
        SELECT
          lt.*,
          debit_entry."walletAccountId" AS debit_wallet_account_id,
          debit_entry.amount AS debit_amount
        FROM ledger_transactions lt
        JOIN input i ON lt."idempotencyKey" = i.idempotency_key
        LEFT JOIN LATERAL (
          SELECT le."walletAccountId", le.amount
          FROM ledger_entries le
          WHERE le."transactionId" = lt.id
            AND le.direction = CAST(${LedgerEntryDirection.DEBIT} AS "LedgerEntryDirection")
          ORDER BY le."createdAt" ASC, le.id ASC
          LIMIT 1
        ) debit_entry ON true
        LIMIT 1
      ),
      request_context AS (
        SELECT
          i.user_id,
          i.room_id,
          i.amount,
          i.idempotency_key,
          i.new_entry_id,
          i.ledger_transaction_id,
          i.ledger_entry_id,
          selected_user.id AS selected_user_id,
          selected_user.email AS user_email,
          selected_user.username AS user_username,
          selected_user."fullName" AS user_full_name,
          selected_room.id AS selected_room_id,
          entry_config.room_status,
          entry_config.category_is_active,
          entry_config.game_mode,
          entry_config.fixed_entry_amount,
          entry_config.min_entry_amount,
          entry_config.max_entry_amount,
          COALESCE(
            existing_transaction.metadata ->> 'roundId',
            current_open_round.id
          ) AS round_id,
          COALESCE(
            existing_transaction.metadata ->> 'walletAccountId',
            current_wallet.id
          ) AS wallet_account_id
        FROM input i
        LEFT JOIN selected_user ON true
        LEFT JOIN selected_room ON true
        LEFT JOIN entry_config ON true
        LEFT JOIN current_open_round ON true
        LEFT JOIN current_wallet ON true
        LEFT JOIN existing_transaction ON true
      ),
      existing_entry AS (
        SELECT e.*
        FROM entries e
        JOIN request_context rc
          ON e."roundId" = rc.round_id
         AND e."userId" = rc.user_id
        LIMIT 1
      ),
      request_state AS (
        SELECT
          rc.*,
          existing_transaction.id IS NOT NULL AS tx_exists,
          existing_transaction.id AS existing_transaction_id,
          COALESCE(
            existing_transaction.metadata ->> 'entryId',
            existing_transaction."referenceId"
          ) AS transaction_entry_id,
          COALESCE(existing_transaction.metadata ->> 'holdState', '') AS hold_state,
          existing_entry.id AS existing_entry_id,
          existing_entry.amount AS existing_entry_amount,
          CASE
            WHEN existing_transaction.id IS NULL THEN rc.new_entry_id
            ELSE COALESCE(
              existing_transaction.metadata ->> 'entryId',
              existing_transaction."referenceId"
            )
          END AS transaction_target_entry_id,
          (
            existing_transaction.id IS NULL OR (
              existing_transaction.type = CAST(${LedgerTransactionType.ENTRY_HOLD} AS "LedgerTransactionType")
              AND existing_transaction."referenceType" = 'ENTRY'
              AND existing_transaction.debit_wallet_account_id = rc.wallet_account_id
              AND existing_transaction.debit_amount = rc.amount
              AND existing_transaction.metadata ->> 'roundId' = rc.round_id
              AND existing_transaction.metadata ->> 'userId' = rc.user_id
              AND existing_transaction.metadata ->> 'walletAccountId' = rc.wallet_account_id
              AND existing_transaction.metadata ->> 'amount' = rc.amount::text
            )
          ) AS tx_matches,
          (
            existing_transaction.id IS NOT NULL
            AND COALESCE(existing_transaction.metadata ->> 'holdState', '') <> 'HELD'
          ) AS applied_replay,
          (
            existing_transaction.id IS NOT NULL
            AND existing_transaction.metadata ->> 'holdState' = 'HELD'
          ) AS held_retry
        FROM request_context rc
        LEFT JOIN existing_transaction ON true
        LEFT JOIN existing_entry ON true
      ),
      target_entry AS (
        SELECT
          CASE
            WHEN rs.tx_exists THEN rs.transaction_target_entry_id
            WHEN rs.existing_entry_id IS NOT NULL THEN rs.existing_entry_id
            ELSE rs.new_entry_id
          END AS id
        FROM request_state rs
      ),
      validation AS (
        SELECT
          rs.*,
          te.id AS target_entry_id,
          (
            rs.held_retry
            AND rs.existing_entry_id IS NOT NULL
            AND rs.existing_entry_id <> te.id
          ) AS held_entry_mismatch,
          (
            rs.game_mode = CAST(${GameMode.FIXED_EQUAL_CHANCE} AS "GameMode")
            AND rs.fixed_entry_amount IS NULL
          ) AS fixed_amount_missing,
          (
            rs.game_mode = CAST(${GameMode.FIXED_EQUAL_CHANCE} AS "GameMode")
            AND rs.fixed_entry_amount IS NOT NULL
            AND rs.amount <> rs.fixed_entry_amount
          ) AS fixed_amount_mismatch,
          (
            rs.game_mode = CAST(${GameMode.FIXED_EQUAL_CHANCE} AS "GameMode")
            AND rs.existing_entry_id IS NOT NULL
            AND NOT rs.tx_exists
          ) AS fixed_top_up_not_allowed,
          (
            rs.game_mode = CAST(${GameMode.FLEXIBLE_PROPORTIONAL} AS "GameMode")
            AND rs.existing_entry_id IS NULL
            AND rs.amount < rs.min_entry_amount
          ) AS below_minimum,
          (
            rs.game_mode = CAST(${GameMode.FLEXIBLE_PROPORTIONAL} AS "GameMode")
            AND rs.existing_entry_id IS NULL
            AND rs.amount > rs.max_entry_amount
          ) AS above_maximum,
          (
            rs.game_mode = CAST(${GameMode.FLEXIBLE_PROPORTIONAL} AS "GameMode")
            AND
            rs.existing_entry_id IS NOT NULL
            AND rs.existing_entry_amount > (rs.max_entry_amount - rs.amount)
          ) AS exceeds_maximum
        FROM request_state rs
        CROSS JOIN target_entry te
      ),
      writable_request AS (
        SELECT *
        FROM validation
        WHERE tx_matches
          AND NOT applied_replay
          AND selected_user_id IS NOT NULL
          AND selected_room_id IS NOT NULL
          AND room_status = CAST(${RoomStatus.ACTIVE} AS "RoomStatus")
          AND category_is_active = true
          AND min_entry_amount IS NOT NULL
          AND max_entry_amount IS NOT NULL
          AND round_id IS NOT NULL
          AND wallet_account_id IS NOT NULL
          AND NOT held_entry_mismatch
          AND NOT fixed_amount_missing
          AND NOT fixed_amount_mismatch
          AND NOT fixed_top_up_not_allowed
          AND NOT below_minimum
          AND NOT above_maximum
          AND NOT exceeds_maximum
      ),
      debit_wallet AS (
        UPDATE wallet_accounts w
        SET
          "balanceSnapshot" = w."balanceSnapshot" - wr.amount,
          "updatedAt" = now()
        FROM writable_request wr
        WHERE w.id = wr.wallet_account_id
          AND w."userId" = wr.user_id
          AND w.type = CAST(${WalletAccountType.MAIN} AS "WalletAccountType")
          AND w."balanceSnapshot" >= wr.amount
          AND NOT wr.tx_exists
          AND EXISTS (SELECT 1 FROM current_open_round)
        RETURNING w.*
      ),
      entry_upsert AS (
        INSERT INTO entries (
          id,
          "roundId",
          "userId",
          amount,
          "ticketStart",
          "ticketEnd",
          "isWinner",
          "createdAt",
          "updatedAt"
        )
        SELECT
          wr.target_entry_id,
          wr.round_id,
          wr.user_id,
          wr.amount,
          NULL,
          NULL,
          false,
          now(),
          now()
        FROM writable_request wr
        WHERE (
          wr.held_retry
          OR EXISTS (SELECT 1 FROM debit_wallet)
        )
          AND EXISTS (SELECT 1 FROM current_open_round)
        ON CONFLICT ("roundId", "userId") DO UPDATE
        SET
          amount = entries.amount + EXCLUDED.amount,
          "ticketStart" = NULL,
          "ticketEnd" = NULL,
          "updatedAt" = now()
        WHERE entries.amount <= (
          (SELECT max_entry_amount FROM writable_request) - (SELECT amount FROM writable_request)
        )
          AND (
            (SELECT game_mode FROM writable_request) = CAST(${GameMode.FLEXIBLE_PROPORTIONAL} AS "GameMode")
            OR entries.id = EXCLUDED.id
          )
          AND (
            NOT (SELECT held_retry FROM writable_request)
            OR entries.id = (SELECT target_entry_id FROM writable_request)
          )
        RETURNING entries.*
      ),
      entry_totals AS (
        SELECT COALESCE(SUM(e.amount), 0)::bigint AS total_entry_amount
        FROM entries e
        JOIN writable_request wr ON e."roundId" = wr.round_id
        WHERE EXISTS (SELECT 1 FROM entry_upsert)
      ),
      inserted_transaction AS (
        INSERT INTO ledger_transactions (
          id,
          type,
          "referenceType",
          "referenceId",
          "idempotencyKey",
          metadata,
          "createdAt"
        )
        SELECT
          wr.ledger_transaction_id,
          CAST(${LedgerTransactionType.ENTRY_HOLD} AS "LedgerTransactionType"),
          'ENTRY',
          entry_upsert.id,
          wr.idempotency_key,
          jsonb_build_object(
            'userId', wr.user_id,
            'roundId', wr.round_id,
            'entryId', entry_upsert.id,
            'amount', wr.amount::text,
            'walletAccountId', debit_wallet.id,
            'holdState', 'APPLIED',
            'appliedAt', to_jsonb(now()) #>> '{}',
            'entryAmountAfter', entry_upsert.amount::text,
            'roundTotalEntryAmountAfter', entry_totals.total_entry_amount::text,
            'roundPayoutAmountAfter', entry_totals.total_entry_amount::text
          ),
          now()
        FROM entry_upsert
        CROSS JOIN entry_totals
        CROSS JOIN debit_wallet
        CROSS JOIN writable_request wr
        WHERE NOT wr.tx_exists
        ON CONFLICT ("idempotencyKey") DO NOTHING
        RETURNING *
      ),
      inserted_ledger_entry AS (
        INSERT INTO ledger_entries (
          id,
          "transactionId",
          "walletAccountId",
          direction,
          amount,
          "balanceAfterSnapshot",
          "createdAt"
        )
        SELECT
          wr.ledger_entry_id,
          inserted_transaction.id,
          debit_wallet.id,
          CAST(${LedgerEntryDirection.DEBIT} AS "LedgerEntryDirection"),
          wr.amount,
          debit_wallet."balanceSnapshot",
          now()
        FROM inserted_transaction
        CROSS JOIN debit_wallet
        CROSS JOIN writable_request wr
        RETURNING *
      ),
      applied_held_transaction AS (
        UPDATE ledger_transactions lt
        SET
          "referenceId" = entry_upsert.id,
          metadata = COALESCE(lt.metadata, '{}'::jsonb) || jsonb_build_object(
            'userId', wr.user_id,
            'roundId', wr.round_id,
            'entryId', entry_upsert.id,
            'amount', wr.amount::text,
            'walletAccountId', wr.wallet_account_id,
            'holdState', 'APPLIED',
            'appliedAt', to_jsonb(now()) #>> '{}',
            'entryAmountAfter', entry_upsert.amount::text,
            'roundTotalEntryAmountAfter', entry_totals.total_entry_amount::text,
            'roundPayoutAmountAfter', entry_totals.total_entry_amount::text
          )
        FROM entry_upsert
        CROSS JOIN entry_totals
        CROSS JOIN writable_request wr
        WHERE lt.id = wr.existing_transaction_id
          AND wr.held_retry
        RETURNING lt.*
      ),
      replay_entry AS (
        SELECT e.*
        FROM entries e
        CROSS JOIN request_state rs
        WHERE rs.applied_replay
          AND (
            e.id = rs.transaction_target_entry_id
            OR (
              rs.transaction_target_entry_id IS NULL
              AND e."roundId" = rs.round_id
              AND e."userId" = rs.user_id
            )
          )
        ORDER BY e."createdAt" ASC, e.id ASC
        LIMIT 1
      ),
      replay_round AS (
        SELECT r.*
        FROM rounds r
        CROSS JOIN request_state rs
        WHERE r.id = rs.round_id
          AND rs.applied_replay
        LIMIT 1
      ),
      final_entry AS (
        SELECT * FROM entry_upsert
        UNION ALL
        SELECT * FROM replay_entry
      ),
      final_round AS (
        SELECT * FROM current_open_round
        WHERE EXISTS (SELECT 1 FROM entry_upsert)
        UNION ALL
        SELECT * FROM replay_round
      ),
      final_wallet AS (
        SELECT * FROM debit_wallet
        UNION ALL
        SELECT current_wallet.*
        FROM current_wallet
        CROSS JOIN request_state rs
        WHERE rs.tx_exists
          AND current_wallet.id = rs.wallet_account_id
      ),
      final_ledger_transaction AS (
        SELECT id FROM inserted_transaction
        UNION ALL
        SELECT id FROM applied_held_transaction
        UNION ALL
        SELECT existing_transaction.id
        FROM existing_transaction
        CROSS JOIN request_state rs
        WHERE rs.applied_replay
      ),
      status AS (
        SELECT
          CASE
            WHEN rs.tx_exists AND NOT rs.tx_matches THEN 'IDEMPOTENCY_MISMATCH'
            WHEN rs.applied_replay AND NOT EXISTS (SELECT 1 FROM replay_entry) THEN 'IDEMPOTENCY_REPLAY_MISSING'
            WHEN rs.applied_replay THEN 'REPLAY'
            WHEN rs.selected_user_id IS NULL THEN 'USER_NOT_FOUND'
            WHEN rs.selected_room_id IS NULL THEN 'ROOM_NOT_FOUND'
            WHEN rs.room_status IS DISTINCT FROM CAST(${RoomStatus.ACTIVE} AS "RoomStatus") THEN 'ROOM_NOT_ACTIVE'
            WHEN rs.category_is_active IS DISTINCT FROM true THEN 'CATEGORY_INACTIVE'
            WHEN rs.min_entry_amount IS NULL OR rs.max_entry_amount IS NULL THEN 'ENTRY_CONFIG_MISSING'
            WHEN NOT EXISTS (SELECT 1 FROM current_open_round) THEN 'ROUND_NOT_OPEN'
            WHEN rs.wallet_account_id IS NULL THEN 'WALLET_NOT_FOUND'
            WHEN v.held_entry_mismatch THEN 'ENTRY_HELD_MISMATCH'
            WHEN v.fixed_amount_missing THEN 'FIXED_ENTRY_AMOUNT_REQUIRED'
            WHEN v.fixed_amount_mismatch THEN 'FIXED_ENTRY_AMOUNT_MISMATCH'
            WHEN v.fixed_top_up_not_allowed THEN 'FIXED_TOP_UP_NOT_ALLOWED'
            WHEN v.below_minimum THEN 'ENTRY_BELOW_MIN'
            WHEN v.above_maximum THEN 'ENTRY_ABOVE_MAX'
            WHEN v.exceeds_maximum THEN 'ENTRY_EXCEEDS_MAX'
            WHEN NOT rs.tx_exists AND NOT EXISTS (SELECT 1 FROM debit_wallet) THEN 'INSUFFICIENT_BALANCE'
            WHEN rs.game_mode = CAST(${GameMode.FIXED_EQUAL_CHANCE} AS "GameMode")
              AND NOT EXISTS (SELECT 1 FROM entry_upsert)
              THEN 'FIXED_TOP_UP_NOT_ALLOWED'
            WHEN NOT EXISTS (SELECT 1 FROM entry_upsert) THEN 'ENTRY_EXCEEDS_MAX'
            WHEN NOT rs.tx_exists AND NOT EXISTS (SELECT 1 FROM inserted_transaction) THEN 'IDEMPOTENCY_RACE'
            WHEN NOT rs.tx_exists AND NOT EXISTS (SELECT 1 FROM inserted_ledger_entry) THEN 'LEDGER_WRITE_FAILED'
            WHEN rs.held_retry AND NOT EXISTS (SELECT 1 FROM applied_held_transaction) THEN 'LEDGER_WRITE_FAILED'
            WHEN EXISTS (SELECT 1 FROM final_entry)
              AND EXISTS (SELECT 1 FROM final_round)
              AND EXISTS (SELECT 1 FROM final_wallet)
              THEN 'SUCCESS'
            ELSE 'UNKNOWN'
          END AS status,
          rs.applied_replay AS reused,
          rs.game_mode AS game_mode,
          rs.existing_entry_amount,
          rs.min_entry_amount,
          rs.max_entry_amount,
          rs.selected_user_id,
          rs.user_email,
          rs.user_username,
          rs.user_full_name,
          COALESCE(
            (SELECT "balanceSnapshot" FROM final_wallet LIMIT 1),
            (SELECT "balanceSnapshot" FROM current_wallet LIMIT 1),
            0
          ) AS wallet_balance_snapshot
        FROM request_state rs
        CROSS JOIN validation v
      )
      SELECT
        status.status AS "status",
        status.reused AS "reused",
        status.game_mode AS "gameMode",
        status.existing_entry_amount AS "existingEntryAmount",
        status.wallet_balance_snapshot AS "walletBalanceSnapshot",
        status.min_entry_amount AS "categoryMinEntryAmount",
        status.max_entry_amount AS "categoryMaxEntryAmount",
        status.selected_user_id AS "userId",
        status.user_email AS "userEmail",
        status.user_username AS "userUsername",
        status.user_full_name AS "userFullName",
        final_entry.id AS "entryId",
        final_entry."roundId" AS "entryRoundId",
        final_entry."userId" AS "entryUserId",
        final_entry.amount AS "entryAmount",
        final_entry."ticketStart" AS "entryTicketStart",
        final_entry."ticketEnd" AS "entryTicketEnd",
        final_entry."isWinner" AS "entryIsWinner",
        final_entry."createdAt" AS "entryCreatedAt",
        final_entry."updatedAt" AS "entryUpdatedAt",
        final_wallet.id AS "walletId",
        final_wallet."userId" AS "walletUserId",
        final_wallet.type::text AS "walletType",
        final_wallet."createdAt" AS "walletCreatedAt",
        final_wallet."updatedAt" AS "walletUpdatedAt",
        final_round.id AS "roundId",
        final_round."roomId" AS "roundRoomId",
        final_round."roundNumber" AS "roundNumber",
        final_round.status AS "roundStatus",
        final_round."openedAt" AS "roundOpenedAt",
        final_round."locksAt" AS "roundLocksAt",
        final_round."lockedAt" AS "roundLockedAt",
        final_round."drawingAt" AS "roundDrawingAt",
        final_round."spinningAt" AS "roundSpinningAt",
        final_round."settlingAt" AS "roundSettlingAt",
        final_round."completedAt" AS "roundCompletedAt",
        final_round."cancelledAt" AS "roundCancelledAt",
        CASE
          WHEN final_round.status = CAST(${RoundStatus.OPEN} AS "RoundStatus")
          THEN (
            SELECT COALESCE(SUM(e.amount), 0)::bigint
            FROM entries e
            WHERE e."roundId" = final_round.id
          )
          ELSE final_round."totalEntryAmount"
        END AS "roundTotalEntryAmount",
        final_round."houseFeeAmount" AS "roundHouseFeeAmount",
        CASE
          WHEN final_round.status = CAST(${RoundStatus.OPEN} AS "RoundStatus")
          THEN (
            SELECT COALESCE(SUM(e.amount), 0)::bigint
            FROM entries e
            WHERE e."roundId" = final_round.id
          )
          ELSE final_round."payoutAmount"
        END AS "roundPayoutAmount",
        final_round."serverSeedHash" AS "roundServerSeedHash",
        final_round."serverSeedReveal" AS "roundServerSeedReveal",
        final_round."winningTicket" AS "roundWinningTicket",
        final_round."winnerUserId" AS "roundWinnerUserId",
        final_round."winnerEntryId" AS "roundWinnerEntryId",
        final_round."spinAngle" AS "roundSpinAngle",
        final_round."idempotencyKey" AS "roundIdempotencyKey",
        final_round."createdAt" AS "roundCreatedAt",
        final_round."updatedAt" AS "roundUpdatedAt"
      FROM status
      LEFT JOIN final_entry ON true
      LEFT JOIN final_wallet ON true
      LEFT JOIN final_round ON true
      LEFT JOIN final_ledger_transaction ON true
      LIMIT 1
    `);

    const row = rows[0];

    if (!row) {
      throw new BadRequestException('Entry write failed. Please retry.');
    }

    args.observeStatus?.(row);

    return this.toPlacementResultFromRow(row, args);
  }

  private async assertFraudAllowed(args: {
    roomId: string;
    userId: string;
    amount: bigint;
    requestId?: string;
    requestAcceptedAt: Date;
  }) {
    if (!this.fraudService) {
      return;
    }

    const currentRound = await this.prisma.round.findFirst({
      where: {
        roomId: args.roomId,
        status: RoundStatus.OPEN,
        OR: [{ locksAt: null }, { locksAt: { gt: args.requestAcceptedAt } }],
      },
      orderBy: { roundNumber: 'desc' },
      select: { id: true },
    });

    const evaluation = await this.fraudService.evaluateEntryAttempt({
      userId: args.userId,
      roomId: args.roomId,
      roundId: currentRound?.id,
      amount: args.amount,
      requestId: args.requestId,
    });

    if (evaluation.decision !== 'BLOCK') {
      return;
    }

    const rapidEntryFinding = evaluation.findings.find(
      (finding) => finding.check === 'RAPID_ENTRY_ATTEMPTS',
    );

    throw new ForbiddenException(
      rapidEntryFinding?.message ??
        'Entry attempt was blocked by fraud protection.',
    );
  }

  private toPlacementResultFromRow(
    row: EntryPlacementRow,
    args: {
      amount: bigint;
    },
  ) {
    if (row.status === 'IDEMPOTENCY_RACE') {
      throw new EntryIdempotencyRaceError();
    }

    if (
      row.status === 'IDEMPOTENCY_MISMATCH' ||
      row.status === 'ENTRY_HELD_MISMATCH'
    ) {
      throw new BadRequestException(
        'Idempotency key was already used for a different entry request.',
      );
    }

    if (row.status === 'IDEMPOTENCY_REPLAY_MISSING') {
      throw new BadRequestException(
        'Previous entry request is missing its committed entry. Manual review required.',
      );
    }

    if (row.status === 'USER_NOT_FOUND') {
      throw new BadRequestException('User not found.');
    }

    if (row.status === 'ROOM_NOT_FOUND') {
      throw new BadRequestException('Room not found.');
    }

    if (row.status === 'ROOM_NOT_ACTIVE') {
      throw new BadRequestException(
        'Entries are only allowed in ACTIVE rooms.',
      );
    }

    if (row.status === 'CATEGORY_INACTIVE') {
      throw new BadRequestException(
        'Entries are only allowed in active categories.',
      );
    }

    if (row.status === 'ENTRY_CONFIG_MISSING') {
      throw new BadRequestException(
        'Room category is not configured for entries.',
      );
    }

    if (row.status === 'WALLET_NOT_FOUND') {
      throw new BadRequestException('MAIN wallet account was not found.');
    }

    if (row.status === 'ENTRY_BELOW_MIN') {
      const minimum = row.categoryMinEntryAmount?.toString() ?? 'unknown';

      throw new BadRequestException(
        `Entry amount is below category minimum. Minimum is ${minimum}.`,
      );
    }

    if (row.status === 'ENTRY_ABOVE_MAX') {
      const maximum = row.categoryMaxEntryAmount?.toString() ?? 'unknown';

      throw new BadRequestException(
        `Entry amount is above category maximum. Maximum is ${maximum}.`,
      );
    }

    if (row.status === 'ENTRY_EXCEEDS_MAX') {
      const currentAmount = row.existingEntryAmount?.toString() ?? 'unknown';
      const maximum = row.categoryMaxEntryAmount?.toString() ?? 'unknown';

      throw new BadRequestException(
        `Entry increase would exceed category maximum. Maximum is ${maximum}, current is ${currentAmount}, attempted add is ${args.amount.toString()}.`,
      );
    }

    if (row.status === 'FIXED_ENTRY_AMOUNT_REQUIRED') {
      throw new BadRequestException(
        'Fixed equal-chance room is missing fixedEntryAmount. Manual admin review required.',
      );
    }

    if (row.status === 'FIXED_ENTRY_AMOUNT_MISMATCH') {
      throw new BadRequestException(
        'Fixed equal-chance room requires the exact configured entry amount.',
      );
    }

    if (row.status === 'FIXED_TOP_UP_NOT_ALLOWED') {
      throw new BadRequestException(
        'Fixed equal-chance room allows one entry per user and does not allow top-ups.',
      );
    }

    if (row.status === 'INSUFFICIENT_BALANCE') {
      const balance = row.walletBalanceSnapshot?.toString() ?? '0';

      throw new BadRequestException(
        `Insufficient MAIN wallet balance. Balance is ${balance}, required is ${args.amount.toString()}.`,
      );
    }

    if (row.status === 'ROUND_NOT_OPEN') {
      throw new BadRequestException(
        'Round is no longer OPEN. Entry was not accepted.',
      );
    }

    if (row.status === 'LEDGER_WRITE_FAILED' || row.status === 'UNKNOWN') {
      throw new BadRequestException('Entry write failed. Please retry.');
    }

    if (!row.entryId || !row.walletId || !row.roundId) {
      throw new BadRequestException(
        'Entry write returned an incomplete result.',
      );
    }

    return {
      entry: this.entryFromPlacementRow(row),
      player: this.playerFromPlacementRow(row),
      wallet: this.walletFromPlacementRow(row),
      round: this.roundFromPlacementRow(row),
      reused: row.status === 'REPLAY' || row.reused,
    };
  }

  private entryFromPlacementRow(row: EntryPlacementRow): Entry {
    if (
      !row.entryId ||
      !row.entryRoundId ||
      !row.entryUserId ||
      row.entryAmount === null ||
      row.entryIsWinner === null ||
      !row.entryCreatedAt ||
      !row.entryUpdatedAt
    ) {
      throw new BadRequestException(
        'Entry write returned an incomplete entry.',
      );
    }

    return {
      id: row.entryId,
      roundId: row.entryRoundId,
      userId: row.entryUserId,
      amount: row.entryAmount,
      ticketStart: row.entryTicketStart,
      ticketEnd: row.entryTicketEnd,
      isWinner: row.entryIsWinner,
      createdAt: row.entryCreatedAt,
      updatedAt: row.entryUpdatedAt,
    };
  }

  private playerFromPlacementRow(row: EntryPlacementRow): PlayerSnapshotSource {
    if (
      !row.userId ||
      !row.userEmail ||
      !row.userUsername ||
      !row.userFullName
    ) {
      throw new BadRequestException(
        'Entry write returned an incomplete player.',
      );
    }

    return {
      id: row.userId,
      email: row.userEmail,
      username: row.userUsername,
      fullName: row.userFullName,
    };
  }

  private walletFromPlacementRow(row: EntryPlacementRow) {
    if (
      !row.walletId ||
      !row.walletType ||
      row.walletBalanceSnapshot === null ||
      !row.walletCreatedAt ||
      !row.walletUpdatedAt
    ) {
      throw new BadRequestException(
        'Entry write returned an incomplete wallet.',
      );
    }

    return this.toWalletSnapshot({
      id: row.walletId,
      userId: row.walletUserId,
      type: row.walletType,
      balanceSnapshot: row.walletBalanceSnapshot,
      createdAt: row.walletCreatedAt,
      updatedAt: row.walletUpdatedAt,
    });
  }

  private roundFromPlacementRow(row: EntryPlacementRow): Round {
    if (
      !row.roundId ||
      !row.roundRoomId ||
      row.roundNumber === null ||
      !row.roundStatus ||
      !row.roundOpenedAt ||
      row.roundTotalEntryAmount === null ||
      row.roundHouseFeeAmount === null ||
      row.roundPayoutAmount === null ||
      !row.roundCreatedAt ||
      !row.roundUpdatedAt
    ) {
      throw new BadRequestException(
        'Entry write returned an incomplete round.',
      );
    }

    return {
      id: row.roundId,
      roomId: row.roundRoomId,
      roundNumber: row.roundNumber,
      status: row.roundStatus,
      openedAt: row.roundOpenedAt,
      locksAt: row.roundLocksAt,
      lockedAt: row.roundLockedAt,
      drawingAt: row.roundDrawingAt,
      spinningAt: row.roundSpinningAt,
      settlingAt: row.roundSettlingAt,
      completedAt: row.roundCompletedAt,
      cancelledAt: row.roundCancelledAt,
      totalEntryAmount: row.roundTotalEntryAmount,
      houseFeeAmount: row.roundHouseFeeAmount,
      payoutAmount: row.roundPayoutAmount,
      serverSeedHash: row.roundServerSeedHash,
      serverSeedReveal: row.roundServerSeedReveal,
      winningTicket: row.roundWinningTicket,
      winnerUserId: row.roundWinnerUserId,
      winnerEntryId: row.roundWinnerEntryId,
      spinAngle: row.roundSpinAngle,
      idempotencyKey: row.roundIdempotencyKey,
      createdAt: row.roundCreatedAt,
      updatedAt: row.roundUpdatedAt,
    };
  }

  private async inspectExistingPlacementSnapshotByIdempotencyKey(args: {
    idempotencyKey: string;
    amount: bigint;
  }) {
    const transaction = await this.prisma.ledgerTransaction.findUnique({
      where: { idempotencyKey: args.idempotencyKey },
    });

    if (!transaction) {
      return {
        placement: null,
        pendingEntryId: null,
      };
    }

    const roundId = this.getMetadataString(transaction.metadata, 'roundId');
    const userId = this.getMetadataString(transaction.metadata, 'userId');
    const walletAccountId = this.getMetadataString(
      transaction.metadata,
      'walletAccountId',
    );

    if (!roundId || !userId || !walletAccountId) {
      throw new BadRequestException(
        'Previous entry request is missing idempotency metadata. Manual review required.',
      );
    }

    this.assertEntryHoldTransactionMatches(transaction, {
      roundId,
      userId,
      walletAccountId,
      amount: args.amount,
    });

    const compensation = await this.prisma.ledgerTransaction.findUnique({
      where: {
        idempotencyKey: WalletsService.entryHoldCompensationIdempotencyKey(
          transaction.id,
        ),
      },
    });

    if (compensation) {
      throw new BadRequestException(
        'Previous entry request was refunded after a failed write. Retry with a new idempotency key.',
      );
    }

    const holdState = this.getMetadataString(transaction.metadata, 'holdState');

    if (holdState === 'HELD') {
      return {
        placement: null,
        pendingEntryId: this.getMetadataString(transaction.metadata, 'entryId'),
      };
    }

    const entryId =
      this.getMetadataString(transaction.metadata, 'entryId') ?? undefined;

    const entry = entryId
      ? await this.prisma.entry.findUniqueOrThrow({
          where: { id: entryId },
        })
      : await this.prisma.entry.findUniqueOrThrow({
          where: {
            roundId_userId: {
              roundId,
              userId,
            },
          },
        });

    const freshWallet = await this.prisma.walletAccount.findUniqueOrThrow({
      where: { id: walletAccountId },
    });

    const freshRound = await this.prisma.round.findUniqueOrThrow({
      where: { id: roundId },
    });

    const player = await this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        fullName: true,
      },
    });

    return {
      placement: {
        entry: this.toEntrySnapshot(entry),
        player: this.toPlayerSnapshot(player),
        wallet: this.toWalletSnapshot(freshWallet),
        currentRound: this.roundsService.toLiveRoundSnapshot(freshRound),
        reused: true,
      },
      pendingEntryId: entry.id,
    };
  }

  private assertEntryHoldTransactionMatches(
    transaction: {
      id: string;
      type: LedgerTransactionType;
      referenceType: string | null;
      metadata: Prisma.JsonValue | null;
    },
    args: {
      roundId: string;
      userId: string;
      walletAccountId: string;
      amount: bigint;
    },
  ) {
    const matches =
      transaction.type === LedgerTransactionType.ENTRY_HOLD &&
      transaction.referenceType === 'ENTRY' &&
      this.getMetadataString(transaction.metadata, 'roundId') ===
        args.roundId &&
      this.getMetadataString(transaction.metadata, 'userId') === args.userId &&
      this.getMetadataString(transaction.metadata, 'walletAccountId') ===
        args.walletAccountId &&
      this.getMetadataString(transaction.metadata, 'amount') ===
        args.amount.toString();

    if (!matches) {
      throw new BadRequestException(
        'Idempotency key was already used for a different entry request.',
      );
    }
  }

  private getMetadataString(metadata: Prisma.JsonValue | null, key: string) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      return null;
    }

    const value = (metadata as Record<string, unknown>)[key];

    return typeof value === 'string' ? value : null;
  }

  private hashUserId(userId: string) {
    return createHash('sha256').update(userId).digest('hex').slice(0, 12);
  }

  private parseAmount(rawAmount: unknown): bigint {
    if (typeof rawAmount !== 'number') {
      throw new BadRequestException('amount must be a number.');
    }

    if (!Number.isSafeInteger(rawAmount)) {
      throw new BadRequestException('amount must be a safe integer.');
    }

    if (rawAmount <= 0) {
      throw new BadRequestException('amount must be greater than zero.');
    }

    return BigInt(rawAmount);
  }

  private isUniqueConstraintError(error: unknown) {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    );
  }

  private toPlayerSnapshot(user: PlayerSnapshotSource) {
    return {
      id: user.id,
      username: user.username,
      email: user.email,
      fullName: user.fullName,
    };
  }

  private toWalletSnapshot(wallet: {
    id: string;
    userId: string | null;
    type: string;
    balanceSnapshot: bigint;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: wallet.id,
      userId: wallet.userId,
      type: wallet.type,
      balanceSnapshot: wallet.balanceSnapshot.toString(),
      createdAt: wallet.createdAt.toISOString(),
      updatedAt: wallet.updatedAt.toISOString(),
    };
  }

  private toEntrySnapshot(entry: Entry): EntrySnapshot {
    return {
      id: entry.id,
      roundId: entry.roundId,
      userId: entry.userId,
      amount: entry.amount.toString(),
      ticketStart: entry.ticketStart?.toString() ?? null,
      ticketEnd: entry.ticketEnd?.toString() ?? null,
      isWinner: entry.isWinner,
      createdAt: entry.createdAt.toISOString(),
      updatedAt: entry.updatedAt.toISOString(),
    };
  }
}
