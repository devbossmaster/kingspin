import { Module } from "@nestjs/common";
import { RoundsModule } from "../../rounds/rounds.module";
import { AdminRoundsController } from "./admin-rounds.controller";

@Module({
  imports: [RoundsModule],
  controllers: [AdminRoundsController],
})
export class AdminRoundsModule {}
