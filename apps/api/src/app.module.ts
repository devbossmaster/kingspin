import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AdminEntriesModule } from "./modules/admin/entries/admin-entries.module";
import { AdminRoomsModule } from "./modules/admin/rooms/admin-rooms.module";
import { AdminRoundsModule } from "./modules/admin/rounds/admin-rounds.module";
import { AdminWalletsModule } from "./modules/admin/wallets/admin-wallets.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { EntriesModule } from "./modules/entries/entries.module";
import { RoomsModule } from "./modules/rooms/rooms.module";
import { RoundsModule } from "./modules/rounds/rounds.module";
import { WalletsModule } from "./modules/wallets/wallets.module";
import { PrismaModule } from "./prisma/prisma.module";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
    }),
    PrismaModule,
    CategoriesModule,
    RoomsModule,
    RoundsModule,
    EntriesModule,
    WalletsModule,
    AdminRoomsModule,
    AdminRoundsModule,
    AdminEntriesModule,
    AdminWalletsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
