import { Module } from "@nestjs/common";
import { AuthBridgeModule } from "../../auth-bridge/auth-bridge.module";
import { AuditModule } from "../../audit/audit.module";
import { RoundsModule } from "../../rounds/rounds.module";
import { AdminRoundsController } from "./admin-rounds.controller";

@Module({
  imports: [RoundsModule, AuthBridgeModule, AuditModule],
  controllers: [AdminRoundsController],
})
export class AdminRoundsModule {}
