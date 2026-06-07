import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AuthBridgeModule } from "../auth-bridge/auth-bridge.module";
import { AuditModule } from "../audit/audit.module";
import { FraudModule } from "../fraud/fraud.module";
import { RoundsModule } from "../rounds/rounds.module";
import { AdminOperationsController } from "./admin-operations.controller";
import { AdminOperationsService } from "./admin-operations.service";

@Module({
  imports: [
    PrismaModule,
    AuthBridgeModule,
    AuditModule,
    FraudModule,
    RoundsModule,
  ],
  controllers: [AdminOperationsController],
  providers: [AdminOperationsService],
  exports: [AdminOperationsService],
})
export class AdminOperationsModule {}
