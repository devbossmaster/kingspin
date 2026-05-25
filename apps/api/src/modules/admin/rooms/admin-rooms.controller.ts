import { Body, Controller, Param, Patch, Post, UseGuards } from "@nestjs/common";
import { AdminDevGuard } from "../../../guards/admin-dev.guard";
import { AdminRoomsService } from "./admin-rooms.service";

@Controller("admin/rooms")
@UseGuards(AdminDevGuard)
export class AdminRoomsController {
  constructor(private readonly adminRoomsService: AdminRoomsService) {}

  @Post()
  createRoom(@Body() body: unknown) {
    return this.adminRoomsService.createRoom(body);
  }

  @Patch(":id/activate")
  activateRoom(@Param("id") id: string) {
    return this.adminRoomsService.activateRoom(id);
  }

  @Patch(":id/pause")
  pauseRoom(@Param("id") id: string) {
    return this.adminRoomsService.pauseRoom(id);
  }

  @Patch(":id/close")
  closeRoom(@Param("id") id: string) {
    return this.adminRoomsService.closeRoom(id);
  }

  @Patch(":id/archive")
  archiveRoom(@Param("id") id: string) {
    return this.adminRoomsService.archiveRoom(id);
  }
}
