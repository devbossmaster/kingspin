import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
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
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
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

type EntryPreflightRow = {
  userId: string | null;
  userEmail: string | null;
  userUsername: string | null;
  userFullName: string | null;
  userImage: string | null;
  userBannedAt: Date | null;
  userCreatedAt: Date | null;
  userUpdatedAt: Date | null;
  roomId: string | null;
  roomStatus: string | null;
  roomGameMode: GameMode | null;
  roomFixedEntryAmount: bigint | null;
  categoryIsActive: boolean | null;
  categoryMinEntryAmount: bigint | null;
  categoryMaxEntryAmount: bigint | null;
  roundId: string | null;
  roundStatus: string | null;
  walletId: string | null;
  walletBalanceSnapshot: bigint | null;
};

type EntryPlacementStatus =
  | 'SUCCESS'
  | 'REPLAY'
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

const ENTRY_TIMING_WARN_THRESHOLD_MS = 1_500;

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
    );
  }

  private async placeEntryForResolvedUserId(
    roomId: string,
    body: PlaceEntryBody,
    userId: string,
    idempotencyScope: 'entry',
  ) {
    if (!roomId) {
      throw new BadRequestException('roomId is required.');
    }

    const addAmount = this.parseAmount(body?.amount);

    const traceId = `${roomId}:${userId}:${Date.now().toString(36)}`;
    const startedAt = Date.now();
    let previousAt = startedAt;
    let timingFlushed = false;
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
        `[entry-timing:${traceId}] slow entry placement total=${totalMs}ms events=${events}`,
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

    const measure = async <T>(label: string, work: () => Promise<T>) => {
      const operationStartedAt = Date.now();

      try {
        return await work();
      } finally {
        const now = Date.now();

        recordTiming(
          'entry-timing',
          `${label} duration=${now - operationStartedAt}ms total=${now - startedAt}ms`,
        );
      }
    };

    mark('parsed amount');

    const preflight = await measure('prevalidation query', () =>
      this.getEntryPreflight({
        roomId,
        userId,
      }),
    );

    mark('prevalidation reads complete');

    if (!preflight.userId) {
      throw new NotFoundException('User not found.');
    }

    if (!preflight.roomId) {
      throw new NotFoundException('Room not found.');
    }

    if (preflight.roomStatus !== RoomStatus.ACTIVE) {
      throw new BadRequestException(
        'Entries are only allowed in ACTIVE rooms.',
      );
    }

    if (!preflight.categoryIsActive) {
      throw new BadRequestException(
        'Entries are only allowed in active categories.',
      );
    }

    if (!preflight.roundId || preflight.roundStatus !== RoundStatus.OPEN) {
      throw new BadRequestException(
        'Room does not have an OPEN round. Start a round first.',
      );
    }

    if (
      preflight.categoryMinEntryAmount === null ||
      preflight.categoryMaxEntryAmount === null
    ) {
      throw new BadRequestException(
        'Room category is not configured for entries.',
      );
    }

    const roundId = preflight.roundId;
    const minEntryAmount = preflight.categoryMinEntryAmount;
    const maxEntryAmount = preflight.categoryMaxEntryAmount;
    const user = this.toPlayerFromPreflight(preflight);

    const requestIdempotencyKey =
      typeof body?.idempotencyKey === 'string' &&
      body.idempotencyKey.trim().length > 0
        ? body.idempotencyKey.trim()
        : `${idempotencyScope}:${roundId}:${user.id}:${randomUUID()}`;

    const entryId = randomUUID();

    try {
      mark('before transaction');

      const result = await this.prisma.$transaction(async (tx) => {
        /**
         * Important performance/safety fix:
         *
         * Keep the source-of-truth write in Postgres, but collapse the remote
         * round trips. One SQL statement performs the guarded wallet debit,
         * append-only ledger insert, entry upsert, and OPEN-round total update.
         * Any rejected status throws inside this transaction callback, so
         * every partial write rolls back together.
         */
        const operationStartedAt = Date.now();
        const placement = await this.writeEntryPlacementInTransaction(tx, {
          roomId,
          userId: user.id,
          roundId,
          walletAccountId: preflight.walletId,
          amount: addAmount,
          minEntryAmount,
          maxEntryAmount,
          idempotencyKey: requestIdempotencyKey,
          entryId,
          ledgerTransactionId: randomUUID(),
          ledgerEntryId: randomUUID(),
        });

        const durationMs = Date.now() - operationStartedAt;
        recordTiming(
          'wallet-hold-timing',
          `compact wallet-ledger-entry write duration=${durationMs}ms`,
        );
        mark('tx compact placement write');

        return placement;
      }, this.transactionOptions);

      mark('transaction complete');
      flushTimingIfSlow();

      return {
        entry: this.toEntrySnapshot(result.entry),
        player: this.toPlayerSnapshot(user),
        wallet: result.wallet,
        currentRound: this.roundsService.toRoundSnapshot(result.round),
        reused: result.reused,
      };
    } catch (error) {
      mark('failed before throw');
      flushTimingIfSlow();
      /**
       * If a duplicate idempotency key wins a race, try to replay the completed
       * placement instead of failing the user's click.
       */
      if (this.isUniqueConstraintError(error)) {
        const replayInspection = await this.inspectExistingPlacementSnapshot({
          idempotencyKey: requestIdempotencyKey,
          roundId,
          userId: user.id,
          walletAccountId: preflight.walletId ?? '',
          amount: addAmount,
          player: user,
        });

        if (replayInspection.placement) {
          return replayInspection.placement;
        }

        throw new BadRequestException(
          'Duplicate entry request detected. Use a new idempotency key and retry safely.',
        );
      }

      if (error instanceof EntryIdempotencyRaceError) {
        const replayInspection = await this.inspectExistingPlacementSnapshot({
          idempotencyKey: requestIdempotencyKey,
          roundId,
          userId: user.id,
          walletAccountId: preflight.walletId ?? '',
          amount: addAmount,
          player: user,
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

  private async getEntryPreflight(args: {
    roomId: string;
    userId: string;
  }): Promise<EntryPreflightRow> {
    const rows = await this.prisma.$queryRaw<EntryPreflightRow[]>(Prisma.sql`
      WITH selected_user AS (
        SELECT
          u.id,
          u.email,
          u.username,
          u."fullName",
          u.image,
          u."bannedAt",
          u."createdAt",
          u."updatedAt"
        FROM users u
        WHERE u.id = ${args.userId}
        LIMIT 1
      ),
      selected_room AS (
        SELECT
          r.id,
          r.status,
          r."categoryId",
          r."gameMode",
          r."fixedEntryAmount"
        FROM rooms r
        WHERE r.id = ${args.roomId}
        LIMIT 1
      )
      SELECT
        u.id AS "userId",
        u.email AS "userEmail",
        u.username AS "userUsername",
        u."fullName" AS "userFullName",
        u.image AS "userImage",
        u."bannedAt" AS "userBannedAt",
        u."createdAt" AS "userCreatedAt",
        u."updatedAt" AS "userUpdatedAt",
        r.id AS "roomId",
        r.status::text AS "roomStatus",
        r."gameMode" AS "roomGameMode",
        r."fixedEntryAmount" AS "roomFixedEntryAmount",
        c."isActive" AS "categoryIsActive",
        c."minEntryAmount" AS "categoryMinEntryAmount",
        c."maxEntryAmount" AS "categoryMaxEntryAmount",
        current_round.id AS "roundId",
        current_round.status::text AS "roundStatus",
        wallet.id AS "walletId",
        wallet."balanceSnapshot" AS "walletBalanceSnapshot"
      FROM (SELECT 1) source
      LEFT JOIN selected_user u ON true
      LEFT JOIN selected_room r ON true
      LEFT JOIN categories c ON c.id = r."categoryId"
      LEFT JOIN LATERAL (
        SELECT
          ro.id,
          ro.status
        FROM rounds ro
        WHERE ro."roomId" = r.id
          AND ro.status = CAST(${RoundStatus.OPEN} AS "RoundStatus")
        ORDER BY ro."roundNumber" DESC
        LIMIT 1
      ) current_round ON true
      LEFT JOIN wallet_accounts wallet
        ON wallet."userId" = u.id
       AND wallet.type = CAST(${WalletAccountType.MAIN} AS "WalletAccountType")
      LIMIT 1
    `);

    return (
      rows[0] ?? {
        userId: null,
        userEmail: null,
        userUsername: null,
        userFullName: null,
        userImage: null,
        userBannedAt: null,
        userCreatedAt: null,
        userUpdatedAt: null,
        roomId: null,
        roomStatus: null,
        roomGameMode: null,
        roomFixedEntryAmount: null,
        categoryIsActive: null,
        categoryMinEntryAmount: null,
        categoryMaxEntryAmount: null,
        roundId: null,
        roundStatus: null,
        walletId: null,
        walletBalanceSnapshot: null,
      }
    );
  }

  private async writeEntryPlacementInTransaction(
    tx: Prisma.TransactionClient,
    args: {
      roomId: string;
      userId: string;
      roundId: string;
      walletAccountId: string | null;
      amount: bigint;
      minEntryAmount: bigint;
      maxEntryAmount: bigint;
      idempotencyKey: string;
      entryId: string;
      ledgerTransactionId: string;
      ledgerEntryId: string;
    },
  ) {
    const rows = await tx.$queryRaw<EntryPlacementRow[]>(Prisma.sql`
      WITH input AS (
        SELECT
          ${args.userId}::text AS user_id,
          ${args.roomId}::text AS room_id,
          ${args.roundId}::text AS round_id,
          ${args.walletAccountId}::text AS wallet_account_id,
          ${args.amount}::bigint AS amount,
          ${args.minEntryAmount}::bigint AS min_entry_amount,
          ${args.maxEntryAmount}::bigint AS max_entry_amount,
          ${args.idempotencyKey}::text AS idempotency_key,
          ${args.entryId}::text AS new_entry_id,
          ${args.ledgerTransactionId}::text AS ledger_transaction_id,
          ${args.ledgerEntryId}::text AS ledger_entry_id
      ),
      existing_entry AS (
        SELECT e.*
        FROM entries e
        JOIN input i
          ON e."roundId" = i.round_id
         AND e."userId" = i.user_id
        LIMIT 1
      ),
      round_gate AS (
        SELECT pg_advisory_xact_lock_shared(hashtext(i.round_id)::bigint)
        FROM input i
      ),
      current_open_round AS (
        SELECT r.*
        FROM rounds r
        JOIN input i ON r.id = i.round_id
        CROSS JOIN round_gate
        WHERE r.status = CAST(${RoundStatus.OPEN} AS "RoundStatus")
        LIMIT 1
      ),
      entry_config AS (
        SELECT
          r."gameMode" AS game_mode,
          r."fixedEntryAmount" AS fixed_entry_amount,
          c."minEntryAmount" AS min_entry_amount,
          c."maxEntryAmount" AS max_entry_amount
        FROM rooms r
        JOIN categories c ON c.id = r."categoryId"
        JOIN input i ON r.id = i.room_id
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
      request_state AS (
        SELECT
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
            WHEN existing_transaction.id IS NULL THEN i.new_entry_id
            ELSE COALESCE(
              existing_transaction.metadata ->> 'entryId',
              existing_transaction."referenceId"
            )
          END AS transaction_target_entry_id,
          (
            existing_transaction.id IS NULL OR (
              existing_transaction.type = CAST(${LedgerTransactionType.ENTRY_HOLD} AS "LedgerTransactionType")
              AND existing_transaction."referenceType" = 'ENTRY'
              AND existing_transaction.debit_wallet_account_id = i.wallet_account_id
              AND existing_transaction.debit_amount = i.amount
              AND existing_transaction.metadata ->> 'roundId' = i.round_id
              AND existing_transaction.metadata ->> 'userId' = i.user_id
              AND existing_transaction.metadata ->> 'walletAccountId' = i.wallet_account_id
              AND existing_transaction.metadata ->> 'amount' = i.amount::text
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
        FROM input i
        LEFT JOIN existing_transaction ON true
        LEFT JOIN existing_entry ON true
      ),
      target_entry AS (
        SELECT
          CASE
            WHEN rs.tx_exists THEN rs.transaction_target_entry_id
            WHEN rs.existing_entry_id IS NOT NULL THEN rs.existing_entry_id
            ELSE i.new_entry_id
          END AS id
        FROM input i
        CROSS JOIN request_state rs
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
            entry_config.game_mode = CAST(${GameMode.FIXED_EQUAL_CHANCE} AS "GameMode")
            AND entry_config.fixed_entry_amount IS NULL
          ) AS fixed_amount_missing,
          (
            entry_config.game_mode = CAST(${GameMode.FIXED_EQUAL_CHANCE} AS "GameMode")
            AND entry_config.fixed_entry_amount IS NOT NULL
            AND i.amount <> entry_config.fixed_entry_amount
          ) AS fixed_amount_mismatch,
          (
            entry_config.game_mode = CAST(${GameMode.FIXED_EQUAL_CHANCE} AS "GameMode")
            AND rs.existing_entry_id IS NOT NULL
            AND NOT rs.tx_exists
          ) AS fixed_top_up_not_allowed,
          (
            entry_config.game_mode = CAST(${GameMode.FLEXIBLE_PROPORTIONAL} AS "GameMode")
            AND rs.existing_entry_id IS NULL
            AND i.amount < entry_config.min_entry_amount
          ) AS below_minimum,
          (
            entry_config.game_mode = CAST(${GameMode.FLEXIBLE_PROPORTIONAL} AS "GameMode")
            AND rs.existing_entry_id IS NULL
            AND i.amount > entry_config.max_entry_amount
          ) AS above_maximum,
          (
            entry_config.game_mode = CAST(${GameMode.FLEXIBLE_PROPORTIONAL} AS "GameMode")
            AND
            rs.existing_entry_id IS NOT NULL
            AND rs.existing_entry_amount > (entry_config.max_entry_amount - i.amount)
          ) AS exceeds_maximum
        FROM input i
        CROSS JOIN request_state rs
        CROSS JOIN target_entry te
        CROSS JOIN entry_config
      ),
      writable_request AS (
        SELECT *
        FROM validation
        WHERE tx_matches
          AND NOT applied_replay
          AND NOT held_entry_mismatch
          AND NOT fixed_amount_missing
          AND NOT fixed_amount_mismatch
          AND NOT fixed_top_up_not_allowed
          AND NOT below_minimum
          AND NOT above_maximum
          AND NOT exceeds_maximum
      ),
      current_wallet AS (
        SELECT w.*
        FROM wallet_accounts w
        JOIN input i ON w.id = i.wallet_account_id
        LIMIT 1
      ),
      debit_wallet AS (
        UPDATE wallet_accounts w
        SET
          "balanceSnapshot" = w."balanceSnapshot" - i.amount,
          "updatedAt" = now()
        FROM input i
        CROSS JOIN writable_request wr
        WHERE w.id = i.wallet_account_id
          AND w."userId" = i.user_id
          AND w.type = CAST(${WalletAccountType.MAIN} AS "WalletAccountType")
          AND w."balanceSnapshot" >= i.amount
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
          i.round_id,
          i.user_id,
          i.amount,
          NULL,
          NULL,
          false,
          now(),
          now()
        FROM input i
        CROSS JOIN writable_request wr
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
          (SELECT max_entry_amount FROM entry_config) - (SELECT amount FROM input)
        )
          AND (
            (SELECT game_mode FROM entry_config) = CAST(${GameMode.FLEXIBLE_PROPORTIONAL} AS "GameMode")
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
        JOIN input i ON e."roundId" = i.round_id
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
          i.ledger_transaction_id,
          CAST(${LedgerTransactionType.ENTRY_HOLD} AS "LedgerTransactionType"),
          'ENTRY',
          entry_upsert.id,
          i.idempotency_key,
          jsonb_build_object(
            'userId', i.user_id,
            'roundId', i.round_id,
            'entryId', entry_upsert.id,
            'amount', i.amount::text,
            'walletAccountId', debit_wallet.id,
            'holdState', 'APPLIED',
            'appliedAt', to_jsonb(now()) #>> '{}',
            'entryAmountAfter', entry_upsert.amount::text,
            'roundTotalEntryAmountAfter', entry_totals.total_entry_amount::text,
            'roundPayoutAmountAfter', entry_totals.total_entry_amount::text
          ),
          now()
        FROM input i
        CROSS JOIN entry_upsert
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
          i.ledger_entry_id,
          inserted_transaction.id,
          debit_wallet.id,
          CAST(${LedgerEntryDirection.DEBIT} AS "LedgerEntryDirection"),
          i.amount,
          debit_wallet."balanceSnapshot",
          now()
        FROM input i
        CROSS JOIN inserted_transaction
        CROSS JOIN debit_wallet
        RETURNING *
      ),
      applied_held_transaction AS (
        UPDATE ledger_transactions lt
        SET
          "referenceId" = entry_upsert.id,
          metadata = COALESCE(lt.metadata, '{}'::jsonb) || jsonb_build_object(
            'userId', i.user_id,
            'roundId', i.round_id,
            'entryId', entry_upsert.id,
            'amount', i.amount::text,
            'walletAccountId', i.wallet_account_id,
            'holdState', 'APPLIED',
            'appliedAt', to_jsonb(now()) #>> '{}',
            'entryAmountAfter', entry_upsert.amount::text,
            'roundTotalEntryAmountAfter', entry_totals.total_entry_amount::text,
            'roundPayoutAmountAfter', entry_totals.total_entry_amount::text
          )
        FROM input i
        CROSS JOIN entry_upsert
        CROSS JOIN entry_totals
        CROSS JOIN writable_request wr
        WHERE lt.id = wr.existing_transaction_id
          AND wr.held_retry
        RETURNING lt.*
      ),
      replay_entry AS (
        SELECT e.*
        FROM entries e
        CROSS JOIN input i
        CROSS JOIN request_state rs
        WHERE rs.applied_replay
          AND (
            e.id = rs.transaction_target_entry_id
            OR (
              rs.transaction_target_entry_id IS NULL
              AND e."roundId" = i.round_id
              AND e."userId" = i.user_id
            )
          )
        ORDER BY e."createdAt" ASC, e.id ASC
        LIMIT 1
      ),
      replay_round AS (
        SELECT r.*
        FROM rounds r
        JOIN input i ON r.id = i.round_id
        CROSS JOIN request_state rs
        WHERE rs.applied_replay
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
            WHEN v.held_entry_mismatch THEN 'ENTRY_HELD_MISMATCH'
            WHEN v.fixed_amount_missing THEN 'FIXED_ENTRY_AMOUNT_REQUIRED'
            WHEN v.fixed_amount_mismatch THEN 'FIXED_ENTRY_AMOUNT_MISMATCH'
            WHEN v.fixed_top_up_not_allowed THEN 'FIXED_TOP_UP_NOT_ALLOWED'
            WHEN v.below_minimum THEN 'ENTRY_BELOW_MIN'
            WHEN v.above_maximum THEN 'ENTRY_ABOVE_MAX'
            WHEN v.exceeds_maximum THEN 'ENTRY_EXCEEDS_MAX'
            WHEN NOT rs.applied_replay AND NOT EXISTS (SELECT 1 FROM current_open_round) THEN 'ROUND_NOT_OPEN'
            WHEN NOT rs.tx_exists AND NOT EXISTS (SELECT 1 FROM debit_wallet) THEN 'INSUFFICIENT_BALANCE'
            WHEN (SELECT game_mode FROM entry_config) = CAST(${GameMode.FIXED_EQUAL_CHANCE} AS "GameMode")
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
          rs.existing_entry_amount,
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
        status.existing_entry_amount AS "existingEntryAmount",
        status.wallet_balance_snapshot AS "walletBalanceSnapshot",
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

    return this.toPlacementResultFromRow(row, args);
  }

  private toPlacementResultFromRow(
    row: EntryPlacementRow,
    args: {
      amount: bigint;
      minEntryAmount: bigint;
      maxEntryAmount: bigint;
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

    if (row.status === 'ENTRY_BELOW_MIN') {
      throw new BadRequestException(
        `Entry amount is below category minimum. Minimum is ${args.minEntryAmount.toString()}.`,
      );
    }

    if (row.status === 'ENTRY_ABOVE_MAX') {
      throw new BadRequestException(
        `Entry amount is above category maximum. Maximum is ${args.maxEntryAmount.toString()}.`,
      );
    }

    if (row.status === 'ENTRY_EXCEEDS_MAX') {
      const currentAmount = row.existingEntryAmount?.toString() ?? 'unknown';

      throw new BadRequestException(
        `Entry increase would exceed category maximum. Maximum is ${args.maxEntryAmount.toString()}, current is ${currentAmount}, attempted add is ${args.amount.toString()}.`,
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
      wallet: this.walletFromPlacementRow(row),
      round: this.roundFromPlacementRow(row),
      reused: row.status === 'REPLAY' || row.reused,
    };
  }

  private toPlayerFromPreflight(row: EntryPreflightRow): PlayerSnapshotSource {
    if (
      !row.userId ||
      !row.userEmail ||
      !row.userUsername ||
      !row.userFullName
    ) {
      throw new NotFoundException('User not found.');
    }

    return {
      id: row.userId,
      email: row.userEmail,
      username: row.userUsername,
      fullName: row.userFullName,
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

  private async inspectExistingPlacementSnapshot(args: {
    idempotencyKey: string;
    roundId: string;
    userId: string;
    walletAccountId: string;
    amount: bigint;
    player: PlayerSnapshotSource;
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

    this.assertEntryHoldTransactionMatches(transaction, args);

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
              roundId: args.roundId,
              userId: args.userId,
            },
          },
        });

    const freshWallet = await this.prisma.walletAccount.findUniqueOrThrow({
      where: { id: args.walletAccountId },
    });

    const freshRound = await this.prisma.round.findUniqueOrThrow({
      where: { id: args.roundId },
    });

    return {
      placement: {
        entry: this.toEntrySnapshot(entry),
        player: this.toPlayerSnapshot(args.player),
        wallet: this.toWalletSnapshot(freshWallet),
        currentRound: this.roundsService.toRoundSnapshot(freshRound),
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
