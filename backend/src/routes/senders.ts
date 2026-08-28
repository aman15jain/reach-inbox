import { Router } from "express";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { createEtherealAccount } from "../services/mailer";

export const sendersRouter = Router();

sendersRouter.get("/", requireAuth, async (req, res) => {
  const senders = await prisma.sender.findMany({
    where: { userId: req.userId },
    select: { id: true, email: true, displayName: true, createdAt: true },
    orderBy: { createdAt: "asc" },
  });
  res.json(senders);
});

sendersRouter.post("/", requireAuth, async (req, res) => {
  const { email, displayName } = req.body as { email?: string; displayName?: string };
  if (!email) return res.status(400).json({ error: "email is required" });

  const smtp = await createEtherealAccount();
  const sender = await prisma.sender.create({
    data: {
      userId: req.userId!,
      email,
      displayName: displayName || email,
      ...smtp,
    },
  });
  res.status(201).json({ id: sender.id, email: sender.email, displayName: sender.displayName });
});
