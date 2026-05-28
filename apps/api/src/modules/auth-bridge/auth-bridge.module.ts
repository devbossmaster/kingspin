import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { AdminRbacGuard } from "./admin-rbac.guard";
import { AuthBridgeService } from "./auth-bridge.service";
import { AuthGuard } from "./auth.guard";

@Module({
  imports: [PrismaModule],
  providers: [AuthBridgeService, AuthGuard, AdminRbacGuard],
  exports: [AuthBridgeService, AuthGuard, AdminRbacGuard],
})
export class AuthBridgeModule {}
