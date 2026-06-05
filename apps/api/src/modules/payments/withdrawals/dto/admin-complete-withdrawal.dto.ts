import { z } from 'zod';

export const AdminCompleteWithdrawalDtoSchema = z
  .object({
    externalReference: z.string().trim().min(1).max(200),
  })
  .strict();
