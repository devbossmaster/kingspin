You are working in my Kingspin / SpinPro repo. Finish the Rocky Rabbit-style mobile room in one pass.

New final goal:
Make the room simple, fast, smooth, and visually clear like Rocky Rabbit.

Important updated UX:
- Do NOT use the old WinnerReveal modal.
- Do NOT reveal the winner only inside the spin center.
- After spinning ends, show a small fast RESULT REVEAL CARD overlay/pop inside the room.
- The result card should pop immediately after spinning, with exploding particles/confetti/coin particles.
- The player list should highlight the winner directly after spinning.
- The result card should show:
  - WINNER
  - winner name
  - Winner gets netPrizeAmount
  - Next round countdown
  - Continue/close optional, but it should auto-hide when next round starts.
- The result card should feel fast, not like the old slow modal.

Timing requirements:
- Entry open period should be 60 seconds.
- Spinning period should be 8 seconds.
- Cooldown/result period before next round should be 10 seconds.
- Frontend and backend must be synced.
- Backend should be source of truth for cooldown / next round countdown.
- Frontend should use currentRound.msUntilNextRound and currentRound.msUntilPhaseEnd.
- Do not hardcode fake countdowns in the UI except fallback.
- Update frontend spin duration to match backend spinningPhase = 8_000.

Backend timing:
In apps/api/src/modules/rounds/public-round-phase.ts, set:

export const ROUND_MACHINE_TIMINGS_MS = {
  lockedPhase: 800,
  drawingPhase: 300,
  spinningPhase: 8_000,
  settlingPhase: 300,
  cooldownPhase: 10_000,
};

export const PUBLIC_COMPLETED_ROUND_VISIBILITY_MS =
  ROUND_MACHINE_TIMINGS_MS.cooldownPhase;

export const PUBLIC_SKIPPED_EMPTY_ROUND_VISIBILITY_MS = 1_500;
export const PUBLIC_SINGLE_PLAYER_REFUND_ROUND_VISIBILITY_MS = 2_500;
export const PUBLIC_CANCELLED_ROUND_VISIBILITY_MS =
  PUBLIC_SINGLE_PLAYER_REFUND_ROUND_VISIBILITY_MS;

Entry/open round duration:
- Make room entry open duration 60 seconds.
- If rooms use room.roundDurationMs from DB, ensure Base/FB01 rooms are configured to 60_000.
- If there is seed/default room config, update default roundDurationMs to 60_000.
- Do not fake 60 seconds only in frontend.

Wheel requirements:
File: apps/web/components/spinpro/spinning-wheel.tsx

- Update SPIN_DURATION_MS to 8_000.
- Keep landing logic safe:
  getFinalWheelAngle(spinAngle) = normalizeDegrees(360 - normalizeDegrees(spinAngle)).
- Wheel center during ENTRY_OPEN/RANDOMIZING/SPINNING should show “Winner Gets” and netPrizeAmount.
- Do not show total pool inside the wheel center.
- During RESULT, the wheel can show simple “Result” or winner name, but the main reveal should be the separate result card overlay.
- Do not remount SVG on join.
- Reset wheel rotation to 0 on new ENTRY_OPEN/WAITING.
- Single-entry wheel should render clean full circle/ring without seam.

30-player color requirement:
- Maximum players per room is 30.
- Ensure every player can have a distinguishable slice color.
- Update PLAYER_SLICE_COLORS / palette logic in player-display.ts or related file to include at least 30 visually distinct colors.
- Colors must be stable per player/entry, not random every render.
- Avoid adjacent slices looking too similar when possible.
- Use stable hashing or index + stableKey to map colors.

Result reveal card:
Create or update a component, for example:
apps/web/components/spinpro/result-reveal-card.tsx

Behavior:
- Show when publicPhase === "RESULT" and currentRound.resultReason === "WINNER".
- Use currentRound.winnerEntryId to find winner entry.
- Show winner name from player snapshot.
- Show netPrizeAmount.
- Show countdown from currentRound.msUntilNextRound.
- Include particles/confetti/coins using lightweight CSS only. No heavy animation library unless already installed.
- Animation:
  - card fades/scales in quickly
  - particles burst once when result appears
  - winner row in PlayersList highlights at the same time
- Auto disappears when next ENTRY_OPEN round arrives.
- Must not block the whole room like the old Dialog modal.
- Should be an overlay within the room layout, not a full old modal.
- Should work on mobile max-width 430px.

Page requirements:
File:
apps/web/app/spinpro/[categorySlug]/[roomId]/page.tsx

- Remove old WinnerReveal import/usages.
- Remove old FairnessStrip from mobile room.
- Add ResultRevealCard near wheel/player area.
- Pass:
  entries={state.entries}
  winnerEntryId={visibleWinnerEntryId}
  netPrizeAmount={netPrizeAmount}
  msUntilNextRound={currentRound?.msUntilNextRound}
  resultReason={currentRound?.resultReason}
  publicPhase={publicPhase}
- Keep bottom entry dock visible but it should show correct cooldown/status labels.

Top hero cleanup:
File:
apps/web/components/spinpro/room-rocky-ui.tsx

Current top card is still too big/confusing:
- Remove noisy top stat card if possible, or make it much smaller.
- Do not show duplicate timer/stat boxes on top if the bottom entry button can show state.
- The screenshot shows Base/FB01/Round and Players/Winner Gets/Closes. This is still too much vertical space.
- Goal: more wheel focus.
- Keep only:
  - room name
  - round number
  - small phase pill
  - maybe tiny players count
- Move important action/status to bottom entry button/dock.
- Bottom button should show:
  - Entry open: “Enter 10” or “Your entry 10”
  - Randomizing/Drawing: “Drawing winner...”
  - Spinning: “Spinning...”
  - Result/cooldown: “Next round in 10s”, counting down using backend msUntilNextRound
  - Closed/full/sign-in states as before.
- This means the top UI should not dominate the screen.

Entry dock/button requirement:
File:
apps/web/components/spinpro/room-rocky-ui.tsx and page.tsx

- Bottom CTA button should display all transition states clearly.
- During cooldown/result, show exact backend countdown:
  “Next round in 10s”
- During spinning:
  “Spinning...”
- During randomizing:
  “Drawing winner...”
- During entry open:
  “Enter X” or “Your entry X”
- Keep entry panel simple.

PlayersList:
File:
apps/web/components/spinpro/players-list.tsx

- Winner row should highlight directly after spinning/result.
- Pending row should show “Joining”.
- Keep it simple.
- Use 30-color palette matching wheel.

Store cleanup:
File:
apps/web/stores/room-store.ts

- Remove old popup/modal state:
  isWinnerRevealOpen
  showWinner
  dismissWinner
  lastWinner
  roundLog
- Keep selectedChip, chipOptions, connectionStatus.

useRoom cleanup:
File:
apps/web/hooks/use-room.ts

- Do not call showWinner/dismissWinner.
- Keep latestResult only if still needed elsewhere, otherwise remove if safe.
- Optimistic joining should update immediately.
- Wallet refresh should not block UI.
- On new open round, clear pending entries and latest result state.
- Result state should come from currentRound snapshot, not delayed result fetch.

Round machine service:
File:
apps/api/src/modules/rounds/round-machine.service.ts

Make these updates:
1. Import cancelled visibility:
import {
  PUBLIC_CANCELLED_ROUND_VISIBILITY_MS,
  ROUND_MACHINE_TIMINGS_MS,
} from './public-round-phase';

2. Increase concurrency:
const AUTO_START_CONCURRENCY = 3;
const ROUND_MACHINE_NORMAL_TICK_CONCURRENCY = 4;
const ROUND_MACHINE_URGENT_TICK_CONCURRENCY = 6;

3. Error retry:
Replace 5_000 retry with:
this.scheduleNextTick(roomId, 1_500, ROUND_MACHINE_TICK_PRIORITIES.CATCH_UP);

4. In getVisibleStatusRound, cancelled visibility should use PUBLIC_CANCELLED_ROUND_VISIBILITY_MS:
if (
  latestRound.status === RoundStatus.CANCELLED &&
  latestRound.cancelledAt &&
  now.getTime() <
    latestRound.cancelledAt.getTime() + PUBLIC_CANCELLED_ROUND_VISIBILITY_MS
) {
  return latestRound;
}

5. Keep broadcastMachineResultInBackground.
6. Do not make broadcasts block scheduler.
7. Keep waiting actions silent.
8. SETTLED_ROUND / RESUMED_SETTLEMENT should schedule cooldown using MACHINE_TIMINGS_MS.cooldownPhase, now 10_000.

Gateway:
File:
apps/api/src/gateways/room.gateway.ts

- Ensure visible transitions broadcast canonical fresh round:state quickly:
  LOCKED_ROUND
  DREW_ROUND
  STARTED_SPINNING_ROUND
  STARTED_SETTLING_ROUND
  SETTLED_ROUND
  STARTED_NEXT_ROUND_AFTER_COMPLETION
  CANCELLED_*_AND_STARTED_NEXT
- Do not spam waiting actions.
- Ensure room join/place entry broadcasts updated live state quickly.
- Payload must include currentRound fields:
  phase
  status
  resultReason
  winnerEntryId
  spinAngle
  totalEntryAmount
  platformFeeAmount
  netPrizeAmount
  payoutAmount
  platformFeeBps
  locksAt
  msUntilPhaseEnd
  msUntilNextRound

Rounds service:
File:
apps/api/src/modules/rounds/rounds.service.ts

Only edit if needed:
- Ensure toRoundSnapshot includes correct netPrizeAmount and phase view.
- netPrizeAmount must be winner payout after platform fee.
- Ensure resultReason and msUntilNextRound come from buildPublicRoundPhaseView.
- Ensure winnerEntryId and spinAngle are present on snapshots.

Search and remove/replace old symbols:
Search entire repo for:
WinnerReveal
isWinnerRevealOpen
showWinner
dismissWinner
lastWinner
roundLog
FairnessStrip
MainPhasePanel
RoundResultPanel
WalletHUD
MiniPhaseRail
MiniStat

Rules:
- Remove from mobile room flow.
- Keep admin/desktop only if still used and harmless.
- If WinnerReveal import remains in old code, either remove it or keep winner-reveal.tsx as a no-op compatibility component.

Build/test:
Run the repo’s available commands:
- pnpm lint
- pnpm typecheck
- pnpm build

Fix all TypeScript errors.

Final expected behavior:
- Entry open lasts exactly 60 seconds.
- User joins instantly with optimistic pending row and wheel slice.
- Up to 30 players have distinguishable stable colors.
- Wheel spins for exactly 8 seconds.
- After spin ends, result reveal card pops quickly with particles.
- Winner row highlights immediately.
- Cooldown lasts exactly 10 seconds from backend.
- Bottom button shows “Next round in Xs”.
- New round starts cleanly and wheel resets to top/center.
- Top UI is minimal and does not dominate the screen.