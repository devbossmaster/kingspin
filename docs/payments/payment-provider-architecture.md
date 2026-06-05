# Payment Provider Architecture

Payment providers must not mutate wallets directly. Providers create intents,
fetch or verify provider data, and return normalized results. The central
deposit/withdrawal services own wallet ledger mutations, idempotency, status
transitions, audit, and risk events.

## Current Providers

- `TELEBIRR_RECEIPT`: server-side official receipt page verification fallback.
- `TELEBIRR_OFFICIAL`: placeholder for future official Telebirr API/gateway.
- `MANUAL`, `MOCK`, and other existing stubs remain for controlled local or
  future integrations.

## Deposit Crediting

Deposit crediting goes through `WalletsService.creditDepositInTransaction`.
Telebirr receipt credits use:

```txt
deposit:telebirr-receipt:{receiptNo}
```

This makes verification retries and response failures safe. Database unique
constraints on receipt/provider references and ledger idempotency keys prevent
duplicate credits.

## Adding A Future Provider

1. Add or implement a provider under `apps/api/src/modules/payments/providers`.
2. Normalize provider-specific webhooks or API responses into service inputs.
3. Keep wallet credit/debit in `DepositsService` or `WithdrawalsService`.
4. Add provider env validation in `@kingspin/env`.
5. Add tests for idempotency, mismatch handling, retry behavior, and audit.

## Withdrawals

Withdrawals remain manual for this phase. Users request withdrawal; admins
complete after manual payout and record an external reference. The system does
not auto-send Telebirr money.
