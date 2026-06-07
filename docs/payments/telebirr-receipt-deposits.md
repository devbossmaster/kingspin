# Telebirr Receipt Deposits

Telebirr receipt verification is a fallback deposit method, not an official
gateway integration. A player manually pays through Telebirr, then submits a
receipt URL, receipt number, or full 127 SMS text. The backend extracts only the
receipt number, fetches the official receipt page server-side, verifies it, and
credits the wallet through the append-only ledger.

## Trust Boundary

- Frontend-submitted amount, payer, receiver, status, and date are never trusted.
- Pasted SMS text is used only to extract the receipt number.
- Raw receipt HTML is not returned by the API and is not stored; only a SHA-256
  hash and selected parsed fields are stored.
- Wallet credit happens only after the backend verifies the official receipt.

## Environment

```env
TELEBIRR_RECEIPT_VERIFICATION_ENABLED=true
TELEBIRR_RECEIPT_BASE_URL=https://transactioninfo.ethiotelecom.et/receipt
TELEBIRR_EXPECTED_RECEIVER_NAME=...
TELEBIRR_EXPECTED_RECEIVER_ACCOUNT=...
TELEBIRR_EXPECTED_SHORT_CODE=...
TELEBIRR_DEPOSIT_MIN=10
TELEBIRR_DEPOSIT_MAX=10000
TELEBIRR_DEPOSIT_INTENT_TTL_MINUTES=15
TELEBIRR_RECEIPT_HTTP_TIMEOUT_MS=8000
TELEBIRR_RECEIPT_MAX_HTML_BYTES=200000
```

Production validation requires HTTPS, the official Telebirr receipt host, sane
limits, and at least one configured receiver identity when verification is
enabled.

## Flow

1. User creates `POST /payments/deposits` with provider `TELEBIRR_RECEIPT`.
2. API creates a `DepositIntent` with expected amount, receiver identity, and
   expiry.
3. User pays manually through Telebirr.
4. User submits `POST /payments/deposits/:id/telebirr-receipt`.
5. API normalizes the receipt id, checks duplicate/rate-limit state, fetches the
   official page, parses it, and records a `PaymentVerificationAttempt`.
6. If verified, API credits the main wallet through the ledger with
   `deposit:telebirr-receipt:{receiptNo}`.
7. Missing or ambiguous official fields move the intent to
   `NEEDS_MANUAL_REVIEW`; clear mismatches are rejected.

## Manual Review

Admin finance users can read deposit details and attempts, manually approve only
`NEEDS_MANUAL_REVIEW` intents with a note, or reject with a reason. Manual
approval still uses the same ledger credit path and idempotency key discipline.

## Withdrawals

Telebirr receipt deposits do not provide automatic payouts. Withdrawals remain a
manual operations flow in this phase: the user requests a withdrawal, an admin
performs the external payout outside the app, records the payout reference when
completing the withdrawal, or rejects the request with a reason. The wallet
reserve/refund ledger path must remain idempotent.

## Failure Modes

- Receipt site unavailable: intent goes to manual review.
- Parser cannot find required official fields: manual review.
- Receiver, amount, currency, receipt id, or time-window mismatch: rejected.
- Duplicate receipt across users: rejected and risk event logged.
- Too many attempts: manual review required.

Official Telebirr API integration remains recommended before accepting real
money at scale. Legal/compliance review, provider approval, reconciliation,
monitoring, support operations, and an independent security review are required
before any public real-money launch.
