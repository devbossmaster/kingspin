import { RoundStatus } from '@kingspin/db';
import type {
  PublicRoundPhase,
  PublicRoundResultReason,
} from '@kingspin/contracts';

export const ROUND_MACHINE_TIMINGS_MS = {
  lockedPhase: 1_500,
  drawingPhase: 500,
  spinningPhase: 5_000,
  settlingPhase: 1_000,
  cooldownPhase: 9_000,
};

export const PUBLIC_COMPLETED_ROUND_VISIBILITY_MS =
  ROUND_MACHINE_TIMINGS_MS.cooldownPhase;

export const PUBLIC_SKIPPED_EMPTY_ROUND_VISIBILITY_MS = 1_500;
export const PUBLIC_SINGLE_PLAYER_REFUND_ROUND_VISIBILITY_MS = 2_500;
export const PUBLIC_CANCELLED_ROUND_VISIBILITY_MS =
  PUBLIC_SINGLE_PLAYER_REFUND_ROUND_VISIBILITY_MS;

const PUBLIC_PHASE_LABELS: Record<PublicRoundPhase, string> = {
  ENTRY_OPEN: 'ENTRY OPEN',
  RANDOMIZING: 'RANDOMIZING',
  SPINNING: 'SPINNING',
  RESULT: 'RESULT',
};

type PublicRoundPhaseInput = {
  status: RoundStatus | null | undefined;
  locksAt?: Date | null;
  lockedAt?: Date | null;
  drawingAt?: Date | null;
  spinningAt?: Date | null;
  settlingAt?: Date | null;
  completedAt?: Date | null;
  cancelledAt?: Date | null;
  winnerEntryId?: string | null;
  entryCount?: number | null;
};

export type PublicRoundPhaseView = {
  phase: PublicRoundPhase;
  phaseLabel: string;
  msUntilPhaseEnd: number;
  msUntilNextRound: number | null;
  resultReason: PublicRoundResultReason;
};

function msUntil(date: Date | null | undefined, now: Date) {
  return date ? Math.max(0, date.getTime() - now.getTime()) : 0;
}

function addMs(date: Date | null | undefined, ms: number) {
  return date ? new Date(date.getTime() + ms) : null;
}

function resultReasonForRound(
  input: PublicRoundPhaseInput,
): PublicRoundResultReason {
  if (
    input.status === RoundStatus.SETTLING ||
    input.status === RoundStatus.COMPLETED
  ) {
    return input.winnerEntryId ? 'WINNER' : null;
  }

  if (input.status !== RoundStatus.CANCELLED) {
    return null;
  }

  return (input.entryCount ?? 0) <= 0 ? 'SKIPPED_EMPTY' : 'REFUNDED_SINGLE';
}

export function getCancelledRoundVisibilityMs(entryCount?: number | null) {
  return (entryCount ?? 0) <= 0
    ? PUBLIC_SKIPPED_EMPTY_ROUND_VISIBILITY_MS
    : PUBLIC_SINGLE_PLAYER_REFUND_ROUND_VISIBILITY_MS;
}

export function buildPublicRoundPhaseView(
  input: PublicRoundPhaseInput,
  now = new Date(),
): PublicRoundPhaseView {
  const status = input.status;

  if (status === RoundStatus.OPEN) {
    const msUntilPhaseEnd = msUntil(input.locksAt, now);

    return {
      phase: 'ENTRY_OPEN',
      phaseLabel: PUBLIC_PHASE_LABELS.ENTRY_OPEN,
      msUntilPhaseEnd,
      msUntilNextRound: null,
      resultReason: null,
    };
  }

  if (status === RoundStatus.LOCKED) {
    const phaseEndsAt = addMs(
      input.lockedAt,
      ROUND_MACHINE_TIMINGS_MS.lockedPhase +
        ROUND_MACHINE_TIMINGS_MS.drawingPhase,
    );

    return {
      phase: 'RANDOMIZING',
      phaseLabel: PUBLIC_PHASE_LABELS.RANDOMIZING,
      msUntilPhaseEnd: msUntil(phaseEndsAt, now),
      msUntilNextRound: null,
      resultReason: null,
    };
  }

  if (status === RoundStatus.DRAWING) {
    const phaseEndsAt = addMs(
      input.drawingAt,
      ROUND_MACHINE_TIMINGS_MS.drawingPhase,
    );

    return {
      phase: 'RANDOMIZING',
      phaseLabel: PUBLIC_PHASE_LABELS.RANDOMIZING,
      msUntilPhaseEnd: msUntil(phaseEndsAt, now),
      msUntilNextRound: null,
      resultReason: null,
    };
  }

  if (status === RoundStatus.SPINNING) {
    const phaseEndsAt = addMs(
      input.spinningAt,
      ROUND_MACHINE_TIMINGS_MS.spinningPhase,
    );

    return {
      phase: 'SPINNING',
      phaseLabel: PUBLIC_PHASE_LABELS.SPINNING,
      msUntilPhaseEnd: msUntil(phaseEndsAt, now),
      msUntilNextRound: null,
      resultReason: null,
    };
  }

  if (status === RoundStatus.SETTLING) {
    const phaseEndsAt = addMs(
      input.settlingAt,
      ROUND_MACHINE_TIMINGS_MS.settlingPhase +
        ROUND_MACHINE_TIMINGS_MS.cooldownPhase,
    );
    const msUntilPhaseEnd = msUntil(phaseEndsAt, now);

    return {
      phase: 'RESULT',
      phaseLabel: PUBLIC_PHASE_LABELS.RESULT,
      msUntilPhaseEnd,
      msUntilNextRound: msUntilPhaseEnd,
      resultReason: resultReasonForRound(input),
    };
  }

  if (status === RoundStatus.COMPLETED) {
    const phaseEndsAt = addMs(
      input.completedAt,
      ROUND_MACHINE_TIMINGS_MS.cooldownPhase,
    );
    const msUntilPhaseEnd = msUntil(phaseEndsAt, now);

    return {
      phase: 'RESULT',
      phaseLabel: PUBLIC_PHASE_LABELS.RESULT,
      msUntilPhaseEnd,
      msUntilNextRound: msUntilPhaseEnd,
      resultReason: resultReasonForRound(input),
    };
  }

  if (status === RoundStatus.CANCELLED) {
    const phaseEndsAt = addMs(
      input.cancelledAt,
      getCancelledRoundVisibilityMs(input.entryCount),
    );
    const msUntilPhaseEnd = msUntil(phaseEndsAt, now);

    return {
      phase: 'RESULT',
      phaseLabel: PUBLIC_PHASE_LABELS.RESULT,
      msUntilPhaseEnd,
      msUntilNextRound: msUntilPhaseEnd,
      resultReason: resultReasonForRound(input),
    };
  }

  return {
    phase: 'RESULT',
    phaseLabel: PUBLIC_PHASE_LABELS.RESULT,
    msUntilPhaseEnd: 0,
    msUntilNextRound: 0,
    resultReason: null,
  };
}
