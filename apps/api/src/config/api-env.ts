import { parseApiEnv, type ApiEnv } from "@kingspin/env";

let cachedApiEnv: ApiEnv | null = null;

export function validateAndStoreApiEnv(
  config: Record<string, string | undefined>,
) {
  cachedApiEnv = parseApiEnv(config);

  return cachedApiEnv;
}

export function getApiEnv() {
  if (!cachedApiEnv) {
    cachedApiEnv = parseApiEnv(process.env);
  }

  return cachedApiEnv;
}

export function resetApiEnvForTesting() {
  cachedApiEnv = null;
}
