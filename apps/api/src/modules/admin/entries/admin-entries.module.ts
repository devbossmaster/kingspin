import { Module } from "@nestjs/common";
import { EntriesModule } from "../../entries/entries.module";
import { AdminEntriesController } from "./admin-entries.controller";

@Module({
  imports: [EntriesModule],
  controllers: [AdminEntriesController],
})
export class AdminEntriesModule {}
