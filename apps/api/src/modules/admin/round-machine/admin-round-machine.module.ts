import { Module } from "@nestjs/common";
import { RoundsModule } from "../../rounds/rounds.module";
import { AdminRoundMachineController } from "./admin-round-machine.controller";

@Module({
  imports: [RoundsModule],
  controllers: [AdminRoundMachineController],
})
export class AdminRoundMachineModule {}
