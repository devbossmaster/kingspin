import { Body, Controller, Get, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AdminAuditAction, Role } from "@kingspin/db";
import { AdminRbacGuard, AdminRoles } from "../../auth-bridge/admin-rbac.guard";
import { AuthGuard } from "../../auth-bridge/auth.guard";
import { CurrentAdmin } from "../../auth-bridge/current-admin.decorator";
import type { AdminBridgeUser } from "../../auth-bridge/auth.types";
import { AuditService } from "../../audit/audit.service";
import { AdminRoomsService } from "./admin-rooms.service";

@Controller("admin/rooms")
@UseGuards(AuthGuard, AdminRbacGuard)
export class AdminRoomsController {
  constructor(
    private readonly adminRoomsService: AdminRoomsService,
    private readonly auditService: AuditService,
  ) {}

  @Get()
  @AdminRoles(Role.ADMIN, Role.SUPPORT, Role.VIEWER)
  listRooms() {
    return this.adminRoomsService.listRooms();
  }

  @Post()
  @AdminRoles(Role.ADMIN)
  async createRoom(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Body() body: unknown,
  ) {
    const room = await this.adminRoomsService.createRoom(body);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROOM_CREATED,
      targetType: "ROOM",
      targetId: room.id,
      after: room,
    });

    return room;
  }

  @Patch(":id/activate")
  @AdminRoles(Role.ADMIN)
  async activateRoom(@CurrentAdmin() admin: AdminBridgeUser, @Param("id") id: string) {
    const room = await this.adminRoomsService.activateRoom(id);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROOM_ACTIVATED,
      targetType: "ROOM",
      targetId: id,
      after: room,
    });

    return room;
  }

  @Patch(":id/pause")
  @AdminRoles(Role.ADMIN)
  async pauseRoom(@CurrentAdmin() admin: AdminBridgeUser, @Param("id") id: string) {
    const room = await this.adminRoomsService.pauseRoom(id);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROOM_PAUSED,
      targetType: "ROOM",
      targetId: id,
      after: room,
    });

    return room;
  }

  @Patch(":id/close")
  @AdminRoles(Role.ADMIN)
  async closeRoom(@CurrentAdmin() admin: AdminBridgeUser, @Param("id") id: string) {
    const room = await this.adminRoomsService.closeRoom(id);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROOM_CLOSED,
      targetType: "ROOM",
      targetId: id,
      after: room,
    });

    return room;
  }

  @Patch(":id/archive")
  @AdminRoles(Role.ADMIN)
  async archiveRoom(@CurrentAdmin() admin: AdminBridgeUser, @Param("id") id: string) {
    const room = await this.adminRoomsService.archiveRoom(id);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROOM_ARCHIVED,
      targetType: "ROOM",
      targetId: id,
      after: room,
    });

    return room;
  }

  @Patch(":id/configure")
  @AdminRoles(Role.ADMIN)
  async configureRoom(
    @CurrentAdmin() admin: AdminBridgeUser,
    @Param("id") id: string,
    @Body() body: unknown,
  ) {
    const room = await this.adminRoomsService.configureRoom(id, body);

    await this.auditService.recordAdminAction({
      actorId: admin.id,
      action: AdminAuditAction.ROOM_CONFIGURED,
      targetType: "ROOM",
      targetId: id,
      after: room,
    });

    return room;
  }
}
