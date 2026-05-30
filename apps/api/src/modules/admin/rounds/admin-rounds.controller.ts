import { Controller, Get, Logger, Param, Post, UseGuards } from "@nestjs/common";
import { AdminAuditAction, Role } from "@kingspin/db";
import { RoomGateway } from "../../../gateways/room.gateway";
import { AdminRbacGuard, AdminRoles } from "../../auth-bridge/admin-rbac.guard";
import { AuthGuard } from "../../auth-bridge/auth.guard";
import { CurrentAdmin } from "../../auth-bridge/current-admin.decorator";
import type { AdminBridgeUser } from "../../auth-bridge/auth.types";
import { AuditService } from "../../audit/audit.service";
import { RoundsService } from "../../rounds/rounds.service";

@Controller("admin/rooms/:roomId/rounds")
@UseGuards(AuthGuard, AdminRbacGuard)
export class AdminRoundsController {
  private readonly logger = new Logger(AdminRoundsController.name);

  constructor(
    private readonly roundsService: RoundsService,
    private readonly auditService: AuditService,
    private readonly roomGateway: RoomGateway,
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

    this.broadcastRoundStateInBackground(roomId, "ADMIN_ROUND_STARTED");

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

    this.broadcastRoundStateInBackground(roomId, "ADMIN_ROUND_LOCKED");

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

    this.broadcastRoundStateInBackground(roomId, "ADMIN_ROUND_DRAWN");

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

    this.broadcastRoundStateInBackground(roomId, "ADMIN_ROUND_SETTLED");

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

    this.broadcastRoundStateInBackground(roomId, "ADMIN_ROUND_CANCELLED");

    return result;
  }

  @Get("latest-result")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.RISK, Role.VIEWER)
  latestResult(@Param("roomId") roomId: string) {
    return this.roundsService.getLatestRoundResultForRoom(roomId);
  }

  private broadcastRoundStateInBackground(roomId: string, reason: string) {
    this.roomGateway.invalidateRoomState(roomId);

    setImmediate(() => {
      void this.roomGateway.broadcastRoundState(roomId, reason).catch(
        (error: unknown) => {
          this.logger.error(
            `Failed to broadcast round state after ${reason} for room ${roomId}`,
            error instanceof Error ? error.stack : String(error),
          );
        },
      );
    });
  }
}
