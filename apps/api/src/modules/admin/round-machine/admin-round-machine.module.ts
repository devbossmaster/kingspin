import { Module } from "@nestjs/common";
import { AuthBridgeModule } from "../../auth-bridge/auth-bridge.module";
import { AuditModule } from "../../audit/audit.module";
import { RoundsModule } from "../../rounds/rounds.module";
import { AdminRoundMachineController } from "./admin-round-machine.controller";

@Module({
  imports: [RoundsModule, AuthBridgeModule, AuditModule],
  controllers: [AdminRoundMachineController],
})
export class AdminRoundMachineModule {}
