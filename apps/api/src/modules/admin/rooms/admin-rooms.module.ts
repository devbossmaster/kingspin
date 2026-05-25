import { Module } from "@nestjs/common";
import { AdminRoomsController } from "./admin-rooms.controller";
import { AdminRoomsService } from "./admin-rooms.service";

@Module({
  controllers: [AdminRoomsController],
  providers: [AdminRoomsService],
})
export class AdminRoomsModule {}
