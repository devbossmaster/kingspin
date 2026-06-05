export type DepositCreditInput = {
  userId: string;
  amount: bigint;
  currency: string;
  provider: string;
  depositIntentId: string;
  providerRef: string;
  idempotencyKey: string;
};
