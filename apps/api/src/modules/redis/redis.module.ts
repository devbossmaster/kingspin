import { Global, Module } from "@nestjs/common";
import { RealtimeMetricsService } from "./realtime-metrics.service";
import { RedisService } from "./redis.service";

@Global()
@Module({
  providers: [RedisService, RealtimeMetricsService],
  exports: [RedisService, RealtimeMetricsService],
})
export class RedisModule {}
