import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { AppController } from "./app.controller";
import { AppService } from "./app.service";
import { PrismaModule } from "./prisma/prisma.module";
import { CategoriesModule } from "./modules/categories/categories.module";
import { RoomsModule } from "./modules/rooms/rooms.module";
import { AdminRoomsModule } from "./modules/admin/rooms/admin-rooms.module";

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [".env"],
    }),
    PrismaModule,
    CategoriesModule,
    RoomsModule,
    AdminRoomsModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
