import { Module } from "@nestjs/common";
import { AuthBridgeService } from "./auth-bridge.service";
import { AuthGuard } from "./auth.guard";

@Module({
  providers: [AuthBridgeService, AuthGuard],
  exports: [AuthBridgeService, AuthGuard],
})
export class AuthBridgeModule {}
