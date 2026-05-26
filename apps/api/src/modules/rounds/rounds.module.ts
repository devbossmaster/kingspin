import { Module } from "@nestjs/common";
import { RoomGateway } from "../../gateways/room.gateway";
import { WalletsModule } from "../wallets/wallets.module";
import { RoundMachineService } from "./round-machine.service";
import { RoundsController } from "./rounds.controller";
import { RoundsService } from "./rounds.service";

@Module({
  imports: [WalletsModule],
  controllers: [RoundsController],
  providers: [RoundsService, RoundMachineService, RoomGateway],
  exports: [RoundsService, RoundMachineService, RoomGateway],
})
export class RoundsModule {}
