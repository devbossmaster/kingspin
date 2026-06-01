import { Module, forwardRef } from "@nestjs/common";
import { RoundsModule } from "../rounds/rounds.module";
import { RoomsController } from "./rooms.controller";
import { RoomsService } from "./rooms.service";

@Module({
  imports: [forwardRef(() => RoundsModule)],
  controllers: [RoomsController],
  providers: [RoomsService],
  exports: [RoomsService],
})
export class RoomsModule {}