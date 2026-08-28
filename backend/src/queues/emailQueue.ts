import { Queue } from "bullmq";
import { redis } from "../lib/redis";

export const EMAIL_QUEUE_NAME = "email-send";

export const emailQueue = new Queue(EMAIL_QUEUE_NAME, {
  connection: redis,
  defaultJobOptions: {
    removeOnComplete: { age: 60 * 60 * 24 * 7, count: 5000 },
    removeOnFail: { age: 60 * 60 * 24 * 30 },
    attempts: 5,
    backoff: { type: "exponential", delay: 5000 },
  },
});

// Deterministic job id per ScheduledEmail row: BullMQ treats a job add with
// an existing, still-present jobId as a no-op, which is what gives us
// idempotent scheduling (re-running a schedule request, or a reconciliation
// pass after a crash, can never enqueue the same email twice).
export function emailJobId(scheduledEmailId: string): string {
  return `email-${scheduledEmailId}`;
}

export interface EmailJobData {
  scheduledEmailId: string;
}

export async function enqueueEmailJob(scheduledEmailId: string, delayMs: number): Promise<string> {
  const jobId = emailJobId(scheduledEmailId);
  const job = await emailQueue.add(
    "send-email",
    { scheduledEmailId } satisfies EmailJobData,
    {
      jobId,
      delay: Math.max(delayMs, 0),
    }
  );
  return job.id!;
}
