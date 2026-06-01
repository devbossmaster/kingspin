import { Module, forwardRef } from "@nestjs/common";
import { RoomGateway } from "../../gateways/room.gateway";
import { PublicGameModule } from "../public-game/public-game.module";
import { RoomsModule } from "../rooms/rooms.module";
import { WalletsModule } from "../wallets/wallets.module";
import { RoundMachineLockService } from "./round-machine-lock.service";
import { RoundMachineService } from "./round-machine.service";
import { RoundsController } from "./rounds.controller";
import { RoundsService } from "./rounds.service";

@Module({
  imports: [WalletsModule, PublicGameModule, forwardRef(() => RoomsModule)],
  controllers: [RoundsController],
  providers: [
    RoundsService,
    RoundMachineLockService,
    RoundMachineService,
    RoomGateway,
  ],
  exports: [
    RoundsService,
    RoundMachineLockService,
    RoundMachineService,
    RoomGateway,
  ],
})
export class RoundsModule {}