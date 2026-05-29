import { Worker } from "bullmq";
import { Prisma, prisma, WorkerJobStatus } from "@kingspin/db";
import { parseApiEnv } from "@kingspin/env";
import { queueNames } from "@kingspin/queues";

const env = parseApiEnv(process.env);

if (!env.ENABLE_REDIS || !env.REDIS_URL) {
  throw new Error("Worker requires ENABLE_REDIS=true and REDIS_URL.");
}

const connection = { url: env.REDIS_URL };

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  const serialized = JSON.stringify(value, (_key, nestedValue) =>
    typeof nestedValue === "bigint" ? nestedValue.toString() : nestedValue,
  );

  if (serialized === undefined) {
    return {};
  }

  return JSON.parse(serialized) as Prisma.InputJsonValue;
}

function logJob(
  queue: string,
  jobId: string,
  name: string,
  status: WorkerJobStatus,
  error?: unknown,
) {
  return prisma.workerJobLog.upsert({
    where: {
      queue_jobId: { queue, jobId },
    },
    update: {
      name,
      status,
      attempts: { increment: 1 },
      error:
        error instanceof Error ? error.message : error ? String(error) : null,
      completedAt:
        status === WorkerJobStatus.COMPLETED ? new Date() : undefined,
      failedAt:
        status === WorkerJobStatus.FAILED ||
        status === WorkerJobStatus.DEAD_LETTER
          ? new Date()
          : undefined,
    },
    create: {
      queue,
      jobId,
      name,
      status,
      attempts: 1,
      maxAttempts: 5,
      error:
        error instanceof Error ? error.message : error ? String(error) : null,
    },
  });
}

function logJobResult(
  queue: string,
  jobId: string,
  name: string,
  metadata: Prisma.InputJsonValue,
) {
  return prisma.workerJobLog.upsert({
    where: {
      queue_jobId: { queue: `${queue}:result`, jobId: `result:${jobId}` },
    },
    update: {
      name,
      status: WorkerJobStatus.COMPLETED,
      attempts: { increment: 1 },
      error: null,
      metadata,
      completedAt: new Date(),
      failedAt: null,
    },
    create: {
      queue: `${queue}:result`,
      jobId: `result:${jobId}`,
      name,
      status: WorkerJobStatus.COMPLETED,
      attempts: 1,
      maxAttempts: 5,
      metadata,
      completedAt: new Date(),
    },
  });
}

function createWorker(
  queue: string,
  handler: (jobId: string, data: unknown) => Promise<void>,
) {
  const worker = new Worker(
    queue,
    async (job) => {
      await logJob(queue, job.id ?? job.name, job.name, WorkerJobStatus.ACTIVE);
      await handler(job.id ?? job.name, job.data);
      await logJob(
        queue,
        job.id ?? job.name,
        job.name,
        WorkerJobStatus.COMPLETED,
      );
    },
    {
      connection,
      concurrency: 3,
      autorun: true,
    },
  );

  worker.on("failed", (job, error) => {
    void logJob(
      queue,
      job?.id ?? "unknown",
      job?.name ?? "unknown",
      job && job.attemptsMade >= (job.opts.attempts ?? 1)
        ? WorkerJobStatus.DEAD_LETTER
        : WorkerJobStatus.RETRYING,
      error,
    );
  });

  return worker;
}

const workers = [
  createWorker(queueNames.reconciliation, async (jobId, data) => {
    // Reports drift only. Corrections must stay admin-reviewed.
    await logJobResult(
      queueNames.reconciliation,
      jobId,
      "reconciliation-result-placeholder",
      toJsonValue({ data, autoCorrected: false }),
    );
  }),
  createWorker(queueNames.settlementRetry, async (jobId, data) => {
    // Intentionally does not decide winners. API/round services own settlement.
    await logJobResult(
      queueNames.settlementRetry,
      jobId,
      "settlement-retry-placeholder",
      toJsonValue({ data, sourceOfTruth: "postgres-round-service" }),
    );
  }),
  createWorker(queueNames.refundRetry, async (jobId, data) => {
    // Refund execution must call existing idempotent wallet methods when wired.
    await logJobResult(
      queueNames.refundRetry,
      jobId,
      "refund-retry-placeholder",
      toJsonValue({ data, idempotentWalletServiceRequired: true }),
    );
  }),
  createWorker(queueNames.fraudCheck, async (jobId, data) => {
    await logJobResult(
      queueNames.fraudCheck,
      jobId,
      "fraud-check-placeholder",
      toJsonValue({ data, advisoryOnly: true }),
    );
  }),
  createWorker(queueNames.notification, async (jobId, data) => {
    await logJobResult(
      queueNames.notification,
      jobId,
      "notification-placeholder",
      toJsonValue({ data }),
    );
  }),
];

async function shutdown() {
  await Promise.all(workers.map((worker) => worker.close()));
  await prisma.$disconnect();
}

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

console.log(`[worker] Started ${workers.length} BullMQ workers.`);
