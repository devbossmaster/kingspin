import { Module } from "@nestjs/common";
import { AuthBridgeModule } from "../auth-bridge/auth-bridge.module";
import { AuditModule } from "../audit/audit.module";
import { FraudModule } from "../fraud/fraud.module";
import { WalletsModule } from "../wallets/wallets.module";
import { PrismaModule } from "../../prisma/prisma.module";
import { AdminPaymentsController } from "./admin-payments.controller";
import { DepositsService } from "./deposits.service";
import { PaymentsController, PaymentWebhooksController } from "./payments.controller";
import { PaymentsProviderRegistry } from "./payments-provider.registry";
import { ManualPaymentProvider } from "./providers/manual-payment.provider";
import { MockPaymentProvider } from "./providers/mock-payment.provider";
import { WithdrawalsService } from "./withdrawals.service";

@Module({
  imports: [
    PrismaModule,
    WalletsModule,
    FraudModule,
    AuditModule,
    AuthBridgeModule,
  ],
  controllers: [
    PaymentsController,
    PaymentWebhooksController,
    AdminPaymentsController,
  ],
  providers: [
    DepositsService,
    WithdrawalsService,
    PaymentsProviderRegistry,
    ManualPaymentProvider,
    MockPaymentProvider,
  ],
  exports: [DepositsService, WithdrawalsService, PaymentsProviderRegistry],
})
export class PaymentsModule {}
