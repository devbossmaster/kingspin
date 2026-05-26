import { Module } from "@nestjs/common";
import { EntriesModule } from "../../entries/entries.module";
import { RoundsModule } from "../../rounds/rounds.module";
import { AdminEntriesController } from "./admin-entries.controller";

@Module({
  imports: [EntriesModule, RoundsModule],
  controllers: [AdminEntriesController],
})
export class AdminEntriesModule {}
