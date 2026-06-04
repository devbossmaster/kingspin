import { Module } from '@nestjs/common';
import { AuditModule } from '../../audit/audit.module';
import { WalletsModule } from '../../wallets/wallets.module';
import { AdminWalletsController } from './admin-wallets.controller';

@Module({
  imports: [WalletsModule, AuditModule],
  controllers: [AdminWalletsController],
})
export class AdminWalletsModule {}
