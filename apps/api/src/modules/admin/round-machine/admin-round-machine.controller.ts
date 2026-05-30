import { Controller, Get, Param, Post, Query, UseGuards } from "@nestjs/common";
import { AdminAuditAction, Role } from "@kingspin/db";
import { RoomGateway } from "../../../gateways/room.gateway";
import { AdminRbacGuard, AdminRoles } from "../../auth-bridge/admin-rbac.guard";
import { AuthGuard } from "../../auth-bridge/auth.guard";
import { CurrentAdmin } from "../../auth-bridge/current-admin.decorator";
import type { AdminBridgeUser } from "../../auth-bridge/auth.types";
import { AuditService } from "../../audit/audit.service";
import { RoundMachineService } from "../../rounds/round-machine.service";

@Controller("admin/rooms/:roomId/machine")
@UseGuards(AuthGuard, AdminRbacGuard)
export class AdminRoundMachineController {
  constructor(
    private readonly roundMachineService: RoundMachineService,
    private readonly auditService: AuditService,
    private readonly roomGateway: RoomGateway,
  ) {}

  @Post("start")
  @AdminRoles(Role.ADMIN)
  async start(@CurrentAdmin() admin: AdminBridgeUser, @Param("roomId") roomId: string) {
    const result = await this.roundMachineService.startRoomMachine(roomId);
    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROUND_STARTED,
      targetType: "ROUND_MACHINE",
      targetId: roomId,
      after: result,
    });
    this.roomGateway.invalidateRoomState(roomId);
    return result;
  }

  @Post("stop")
  @AdminRoles(Role.ADMIN)
  async stop(@CurrentAdmin() admin: AdminBridgeUser, @Param("roomId") roomId: string) {
    const result = await this.roundMachineService.stopRoomMachine(roomId);
    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROUND_CANCELLED,
      targetType: "ROUND_MACHINE",
      targetId: roomId,
      after: result,
    });
    this.roomGateway.invalidateRoomState(roomId);
    return result;
  }

  @Get("status")
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.VIEWER)
  status(@Param("roomId") roomId: string) {
    return this.roundMachineService.getRoomMachineStatus(roomId);
  }

  @Post("advance-once")
  @AdminRoles(Role.ADMIN)
  async advanceOnce(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param("roomId") roomId: string,
    @Query("force") force?: string,
  ) {
    const result = await this.roundMachineService.advanceRoomMachineOnce(roomId, {
      force: force === "true",
    });
    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROUND_SETTLED,
      targetType: "ROUND_MACHINE",
      targetId: roomId,
      after: result,
    });
    return result;
  }
}
