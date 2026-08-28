import { DelayedError, Job, Worker } from "bullmq";
import { redis } from "../lib/redis";
import { prisma } from "../lib/prisma";
import { env } from "../config/env";
import { EMAIL_QUEUE_NAME, EmailJobData } from "../queues/emailQueue";
import { sendEmail } from "../services/mailer";
import { startOfNextHour, tryConsumeHourlySlot, markHourlyLimitNotified } from "../services/rateLimiter";
import { indexEmailDoc } from "../services/elasticsearch";
import { notifySlackRateLimitHit } from "../services/slack";

async function processEmailJob(job: Job<EmailJobData>, token?: string) {
  const { scheduledEmailId } = job.data;

  const email = await prisma.scheduledEmail.findUnique({
    where: { id: scheduledEmailId },
    include: { sender: true },
  });

  if (!email) {
    console.warn(`[worker] scheduled email ${scheduledEmailId} no longer exists, skipping`);
    return;
  }

  // Idempotency guard: if a previous attempt already marked this row sent
  // (e.g. the process crashed after sending but before BullMQ recorded job
  // completion), don't send a second time on retry/redelivery.
  if (email.status === "sent") {
    return;
  }

  const hourlyLimit = email.hourlyLimit || env.maxEmailsPerHourPerSender;
  const gotSlot = await tryConsumeHourlySlot(email.senderId, hourlyLimit);

  if (!gotSlot) {
    const nextWindow = startOfNextHour(new Date());
    const delayMs = nextWindow.getTime() - Date.now() + Math.floor(Math.random() * 5000);

    await prisma.scheduledEmail.update({
      where: { id: email.id },
      data: { status: "rate_limited_delayed", scheduledAt: nextWindow },
    });

    const notifiedNow = await markHourlyLimitNotified(email.senderId);
    if (notifiedNow) {
      await notifySlackRateLimitHit(
        email.userId,
        `:warning: Hourly send limit (${hourlyLimit}/hr) reached for sender *${email.sender.email}*. Remaining emails are being rescheduled to the next hour window (${nextWindow.toISOString()}).`
      );
    }

    // Reschedule this same job into the future instead of failing it, so
    // the email is never dropped and keeps its place using moveToDelayed
    // (requires throwing DelayedError so BullMQ doesn't also mark it
    // completed/failed after we've already moved it).
    if (token) {
      await job.moveToDelayed(Date.now() + delayMs, token);
      throw new DelayedError();
    }
    return;
  }

  await prisma.scheduledEmail.update({ where: { id: email.id }, data: { status: "processing" } });

  try {
    const result = await sendEmail(email.sender, {
      from: { email: email.sender.email, name: email.sender.displayName },
      to: email.recipient,
      subject: email.subject,
      html: email.body,
    });

    const sentAt = new Date();
    await prisma.scheduledEmail.update({
      where: { id: email.id },
      data: { status: "sent", sentAt, previewUrl: result.previewUrl, error: null },
    });

    await indexEmailDoc(email.id, {
      userId: email.userId,
      senderId: email.senderId,
      senderEmail: email.sender.email,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      status: "sent",
      scheduledAt: email.scheduledAt.toISOString(),
      sentAt: sentAt.toISOString(),
    });
  } catch (err) {
    const message = (err as Error).message;
    await prisma.scheduledEmail.update({
      where: { id: email.id },
      data: { status: "failed", error: message, attempts: { increment: 1 } },
    });
    await indexEmailDoc(email.id, {
      userId: email.userId,
      senderId: email.senderId,
      senderEmail: email.sender.email,
      recipient: email.recipient,
      subject: email.subject,
      body: email.body,
      status: "failed",
      scheduledAt: email.scheduledAt.toISOString(),
    });
    throw err; // let BullMQ's attempts/backoff handle retries
  }
}

export function createEmailWorker(): Worker<EmailJobData> {
  const worker = new Worker<EmailJobData>(EMAIL_QUEUE_NAME, processEmailJob, {
    connection: redis,
    concurrency: env.workerConcurrency,
    // Global floor on how close together two sends can start, mimicking
    // provider throttling independent of the per-sender hourly cap above.
    limiter: {
      max: 1,
      duration: env.minDelayBetweenEmailsMs,
    },
  });

  worker.on("failed", (job, err) => {
    console.error(`[worker] job ${job?.id} failed:`, err.message);
  });

  worker.on("completed", (job) => {
    console.log(`[worker] job ${job.id} completed`);
  });

  return worker;
}
