import { Module } from '@nestjs/common';
import { RoundsModule } from '../rounds/rounds.module';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [RoundsModule],
  controllers: [HealthController],
  providers: [HealthService],
})
export class HealthModule {}
