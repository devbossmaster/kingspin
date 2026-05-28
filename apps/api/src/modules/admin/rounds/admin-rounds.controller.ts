import { Controller, Get, Param, Post, UseGuards } from "@nestjs/common";
import { AdminAuditAction, Role } from "@kingspin/db";
import { AdminRbacGuard, AdminRoles } from "../../auth-bridge/admin-rbac.guard";
import { AuthGuard } from "../../auth-bridge/auth.guard";
import { CurrentAdmin } from "../../auth-bridge/current-admin.decorator";
import type { AdminBridgeUser } from "../../auth-bridge/auth.types";
import { AuditService } from "../../audit/audit.service";
import { RoundsService } from "../../rounds/rounds.service";

@Controller("admin/rooms/:roomId/rounds")
@UseGuards(AuthGuard, AdminRbacGuard)
export class AdminRoundsController {
  constructor(
    private readonly roundsService: RoundsService,
    private readonly auditService: AuditService,
  ) {}

  @Post("start")
  @AdminRoles(Role.ADMIN)
  async startRound(@CurrentAdmin() admin: AdminBridgeUser, @Param("roomId") roomId: string) {
    const result = await this.roundsService.startOpenRoundForRoom(roomId);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROUND_STARTED,
      targetType: "ROOM",
      targetId: roomId,
      after: result,
    });

    return result;
  }

  @Post("lock-current")
  @AdminRoles(Role.ADMIN)
  async lockCurrentRound(@CurrentAdmin() admin: AdminBridgeUser, @Param("roomId") roomId: string) {
    const result = await this.roundsService.lockCurrentRoundForRoom(roomId);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROUND_LOCKED,
      targetType: "ROOM",
      targetId: roomId,
      after: result,
    });

    return result;
  }

  @Post("draw-current")
  @AdminRoles(Role.ADMIN)
  async drawCurrentRound(@CurrentAdmin() admin: AdminBridgeUser, @Param("roomId") roomId: string) {
    const result = await this.roundsService.drawCurrentRoundForRoom(roomId);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROUND_DRAWN,
      targetType: "ROOM",
      targetId: roomId,
      after: result,
    });

    return result;
  }

  @Post("settle-current")
  @AdminRoles(Role.ADMIN)
  async settleCurrentRound(@CurrentAdmin() admin: AdminBridgeUser, @Param("roomId") roomId: string) {
    const result = await this.roundsService.settleCurrentRoundForRoom(roomId);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROUND_SETTLED,
      targetType: "ROOM",
      targetId: roomId,
      after: result,
    });

    return result;
  }

  @Post("cancel-current")
  @AdminRoles(Role.ADMIN)
  async cancelCurrentRound(@CurrentAdmin() admin: AdminBridgeUser, @Param("roomId") roomId: string) {
    const result = await this.roundsService.cancelCurrentRoundForRoom(roomId);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROUND_CANCELLED,
      targetType: "ROOM",
      targetId: roomId,
      after: result,
    });

    return result;
  }

  @Get("latest-result")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.RISK, Role.VIEWER)
  latestResult(@Param("roomId") roomId: string) {
    return this.roundsService.getLatestRoundResultForRoom(roomId);
  }
}
