import { randomUUID } from "crypto";
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { emailQueue, emailJobId } from "../queues/emailQueue";
import { indexEmailDocsBulk, searchEmailDocs } from "../services/elasticsearch";
import { extractEmailsFromText } from "../utils/csv";
import { env } from "../config/env";

export const emailsRouter = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

emailsRouter.post("/upload-leads", requireAuth, upload.single("file"), (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file is required" });
  const text = req.file.buffer.toString("utf-8");
  const emails = extractEmailsFromText(text);
  res.json({ count: emails.length, emails });
});

const scheduleSchema = z.object({
  senderId: z.string().uuid(),
  subject: z.string().min(1),
  body: z.string().min(1),
  recipients: z.array(z.string().email()).min(1),
  startTime: z.string().datetime().or(z.string().min(1)),
  delayBetweenEmailsMs: z.number().int().min(0).default(env.minDelayBetweenEmailsMs),
  hourlyLimit: z.number().int().min(1).default(env.maxEmailsPerHourPerSender),
});

emailsRouter.post("/schedule", requireAuth, async (req, res) => {
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Invalid request", details: parsed.error.flatten() });
  }
  const { senderId, subject, body, recipients, startTime, delayBetweenEmailsMs, hourlyLimit } = parsed.data;

  const sender = await prisma.sender.findFirst({ where: { id: senderId, userId: req.userId } });
  if (!sender) return res.status(404).json({ error: "Sender not found" });

  const start = new Date(startTime);
  if (Number.isNaN(start.getTime())) return res.status(400).json({ error: "Invalid startTime" });

  const batchId = randomUUID();
  const rows = recipients.map((recipient, i) => ({
    id: randomUUID(),
    userId: req.userId!,
    senderId,
    batchId,
    recipient,
    subject,
    body,
    delayBetweenMs: delayBetweenEmailsMs,
    hourlyLimit,
    scheduledAt: new Date(start.getTime() + i * delayBetweenEmailsMs),
  }));

  await prisma.scheduledEmail.createMany({ data: rows });

  // BullMQ addBulk keeps this a single round trip even for a
  // thousand-recipient batch, and each job carries the same deterministic
  // jobId scheme as single sends so re-submitting the same schedule request
  // twice (e.g. a double-click) can't double-enqueue.
  await emailQueue.addBulk(
    rows.map((r) => ({
      name: "send-email",
      data: { scheduledEmailId: r.id },
      opts: { jobId: emailJobId(r.id), delay: Math.max(r.scheduledAt.getTime() - Date.now(), 0) },
    }))
  );

  await indexEmailDocsBulk(
    rows.map((r) => ({
      id: r.id,
      doc: {
        userId: r.userId,
        senderId: r.senderId,
        recipient: r.recipient,
        subject: r.subject,
        body: r.body,
        status: "scheduled",
        scheduledAt: r.scheduledAt.toISOString(),
      },
    }))
  );

  res.status(201).json({ batchId, scheduled: rows.length });
});

emailsRouter.get("/scheduled", requireAuth, async (req, res) => {
  const page = Math.max(Number(req.query.page ?? 1), 1);
  const pageSize = Math.min(Number(req.query.pageSize ?? 25), 100);

  const [items, total] = await Promise.all([
    prisma.scheduledEmail.findMany({
      where: { userId: req.userId, status: { in: ["scheduled", "processing", "rate_limited_delayed"] } },
      orderBy: { scheduledAt: "asc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { sender: { select: { email: true } } },
    }),
    prisma.scheduledEmail.count({
      where: { userId: req.userId, status: { in: ["scheduled", "processing", "rate_limited_delayed"] } },
    }),
  ]);

  res.json({ items, total, page, pageSize });
});

emailsRouter.get("/sent", requireAuth, async (req, res) => {
  const page = Math.max(Number(req.query.page ?? 1), 1);
  const pageSize = Math.min(Number(req.query.pageSize ?? 25), 100);

  const [items, total] = await Promise.all([
    prisma.scheduledEmail.findMany({
      where: { userId: req.userId, status: { in: ["sent", "failed"] } },
      orderBy: { sentAt: "desc" },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: { sender: { select: { email: true } } },
    }),
    prisma.scheduledEmail.count({ where: { userId: req.userId, status: { in: ["sent", "failed"] } } }),
  ]);

  res.json({ items, total, page, pageSize });
});

emailsRouter.get("/search", requireAuth, async (req, res) => {
  const q = String(req.query.q ?? "");
  const result = await searchEmailDocs(req.userId!, q);
  res.json(result);
});
