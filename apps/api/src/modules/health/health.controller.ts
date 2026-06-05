import { Controller, Get } from '@nestjs/common';
import { HealthService } from './health.service';

@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth() {
    return this.healthService.getHealth();
  }

  @Get('db')
  getDbHealth() {
    return this.healthService.getDbHealth();
  }

  @Get('redis')
  getRedisHealth() {
    return this.healthService.getRedisHealth();
  }

  @Get('realtime')
  getRealtimeHealth() {
    return this.healthService.getRealtimeHealth();
  }

  @Get('round-machine')
  getRoundMachineHealth() {
    return this.healthService.getRoundMachineHealth();
  }
}
