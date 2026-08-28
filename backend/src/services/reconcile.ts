import { prisma } from "../lib/prisma";
import { enqueueEmailJob, emailQueue, emailJobId } from "../queues/emailQueue";

/**
 * Runs on process startup. BullMQ's delayed jobs already live in Redis and
 * survive an app restart on their own — this exists as a safety net for the
 * case Redis was wiped/recreated (e.g. a fresh container) while Postgres
 * still has the source-of-truth rows. Any scheduled/rate_limited_delayed
 * email whose BullMQ job is missing gets re-enqueued with the same
 * deterministic job id, so this is safe to run every time without ever
 * duplicating a send.
 */
export async function reconcileScheduledEmails(): Promise<void> {
  const pending = await prisma.scheduledEmail.findMany({
    where: { status: { in: ["scheduled", "processing", "rate_limited_delayed"] } },
  });

  let requeued = 0;
  for (const email of pending) {
    const existingJob = await emailQueue.getJob(emailJobId(email.id));
    if (existingJob) continue;

    const delayMs = email.scheduledAt.getTime() - Date.now();
    await enqueueEmailJob(email.id, delayMs);
    if (email.status === "processing") {
      // Was mid-send when the process died; reset to scheduled so it's
      // retried cleanly rather than stuck "processing" forever.
      await prisma.scheduledEmail.update({ where: { id: email.id }, data: { status: "scheduled" } });
    }
    requeued++;
  }

  console.log(`[reconcile] checked ${pending.length} pending emails, re-enqueued ${requeued} missing jobs`);
}
