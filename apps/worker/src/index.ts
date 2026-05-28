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

function logJob(queue: string, jobId: string, name: string, status: WorkerJobStatus, error?: unknown) {
  return prisma.workerJobLog.upsert({
    where: {
      queue_jobId: { queue, jobId },
    },
    update: {
      name,
      status,
      attempts: { increment: 1 },
      error: error instanceof Error ? error.message : error ? String(error) : null,
      completedAt: status === WorkerJobStatus.COMPLETED ? new Date() : undefined,
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
      error: error instanceof Error ? error.message : error ? String(error) : null,
    },
  });
}

function createWorker(queue: string, handler: (jobId: string, data: unknown) => Promise<void>) {
  const worker = new Worker(
    queue,
    async (job) => {
      await logJob(queue, job.id ?? job.name, job.name, WorkerJobStatus.ACTIVE);
      await handler(job.id ?? job.name, job.data);
      await logJob(queue, job.id ?? job.name, job.name, WorkerJobStatus.COMPLETED);
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
  createWorker(queueNames.reconciliation, async (_jobId, data) => {
    // Reports drift only. Corrections must stay admin-reviewed.
    await prisma.workerJobLog.create({
      data: {
        queue: `${queueNames.reconciliation}:result`,
        jobId: `result:${Date.now()}`,
        name: "reconciliation-result-placeholder",
        status: WorkerJobStatus.COMPLETED,
        metadata: toJsonValue({ data, autoCorrected: false }),
      },
    });
  }),
  createWorker(queueNames.settlementRetry, async (_jobId, data) => {
    // Intentionally does not decide winners. API/round services own settlement.
    await prisma.workerJobLog.create({
      data: {
        queue: `${queueNames.settlementRetry}:result`,
        jobId: `result:${Date.now()}`,
        name: "settlement-retry-placeholder",
        status: WorkerJobStatus.COMPLETED,
        metadata: toJsonValue({ data, sourceOfTruth: "postgres-round-service" }),
      },
    });
  }),
  createWorker(queueNames.refundRetry, async (_jobId, data) => {
    // Refund execution must call existing idempotent wallet methods when wired.
    await prisma.workerJobLog.create({
      data: {
        queue: `${queueNames.refundRetry}:result`,
        jobId: `result:${Date.now()}`,
        name: "refund-retry-placeholder",
        status: WorkerJobStatus.COMPLETED,
        metadata: toJsonValue({ data, idempotentWalletServiceRequired: true }),
      },
    });
  }),
  createWorker(queueNames.fraudCheck, async (_jobId, data) => {
    await prisma.workerJobLog.create({
      data: {
        queue: `${queueNames.fraudCheck}:result`,
        jobId: `result:${Date.now()}`,
        name: "fraud-check-placeholder",
        status: WorkerJobStatus.COMPLETED,
        metadata: toJsonValue({ data, advisoryOnly: true }),
      },
    });
  }),
  createWorker(queueNames.notification, async (_jobId, data) => {
    await prisma.workerJobLog.create({
      data: {
        queue: `${queueNames.notification}:result`,
        jobId: `result:${Date.now()}`,
        name: "notification-placeholder",
        status: WorkerJobStatus.COMPLETED,
        metadata: toJsonValue({ data }),
      },
    });
  }),
];

async function shutdown() {
  await Promise.all(workers.map((worker) => worker.close()));
  await prisma.$disconnect();
}

process.on("SIGINT", () => void shutdown().finally(() => process.exit(0)));
process.on("SIGTERM", () => void shutdown().finally(() => process.exit(0)));

console.log(`[worker] Started ${workers.length} BullMQ workers.`);
