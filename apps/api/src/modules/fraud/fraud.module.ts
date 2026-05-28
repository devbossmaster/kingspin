import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { FraudService } from "./fraud.service";

@Module({
  imports: [PrismaModule],
  providers: [FraudService],
  exports: [FraudService],
})
export class FraudModule {}
