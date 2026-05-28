import { Module } from "@nestjs/common";
import { AuthBridgeModule } from "../../auth-bridge/auth-bridge.module";
import { AuditModule } from "../../audit/audit.module";
import { AdminRoomsController } from "./admin-rooms.controller";
import { AdminRoomsService } from "./admin-rooms.service";

@Module({
  imports: [AuthBridgeModule, AuditModule],
  controllers: [AdminRoomsController],
  providers: [AdminRoomsService],
})
export class AdminRoomsModule {}
