import { Injectable } from "@nestjs/common";

export type RealtimeMetricsSnapshot = {
  liveStateBuildCount: number;
  liveStateCacheHitCount: number;
  liveStateCacheMissCount: number;
  liveStateRedisCacheHitCount: number;
  liveStateRedisCacheMissCount: number;
  socketBroadcastCount: number;
  socketBroadcastFlushCount: number;
  socketCoalescedBroadcastCount: number;
  redisLockAcquiredCount: number;
  redisLockContentionCount: number;
  entryRateLimitedCount: number;
};

type RealtimeMetricName = keyof RealtimeMetricsSnapshot;

@Injectable()
export class RealtimeMetricsService {
  private readonly counters: RealtimeMetricsSnapshot = {
    liveStateBuildCount: 0,
    liveStateCacheHitCount: 0,
    liveStateCacheMissCount: 0,
    liveStateRedisCacheHitCount: 0,
    liveStateRedisCacheMissCount: 0,
    socketBroadcastCount: 0,
    socketBroadcastFlushCount: 0,
    socketCoalescedBroadcastCount: 0,
    redisLockAcquiredCount: 0,
    redisLockContentionCount: 0,
    entryRateLimitedCount: 0,
  };

  increment(name: RealtimeMetricName, by = 1) {
    this.counters[name] += by;
  }

  snapshot(): RealtimeMetricsSnapshot {
    return { ...this.counters };
  }
}
