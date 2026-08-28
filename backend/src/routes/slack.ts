import { Router } from "express";
import jwt from "jsonwebtoken";
import { env, isSlackOAuthConfigured } from "../config/env";
import { prisma } from "../lib/prisma";
import { requireAuth } from "../middleware/requireAuth";
import { buildSlackAuthorizeUrl, exchangeSlackCode } from "../services/slack";

export const slackRouter = Router();

slackRouter.get("/connect", requireAuth, (req, res) => {
  if (!isSlackOAuthConfigured) {
    return res.status(503).json({
      error: "Slack OAuth is not configured. Set SLACK_CLIENT_ID and SLACK_CLIENT_SECRET in backend/.env",
    });
  }
  // userId travels through Slack's redirect round-trip in `state` (signed,
  // short-lived) since Slack's callback carries no session of ours.
  const state = jwt.sign({ userId: req.userId }, env.jwtSecret, { expiresIn: "10m" });
  res.json({ url: buildSlackAuthorizeUrl(state) });
});

slackRouter.get("/callback", async (req, res) => {
  try {
    const { code, state } = req.query as { code?: string; state?: string };
    if (!code || !state) throw new Error("Missing code/state");
    const { userId } = jwt.verify(state, env.jwtSecret) as { userId: string };

    const result = await exchangeSlackCode(code);

    await prisma.slackIntegration.upsert({
      where: { userId },
      create: {
        userId,
        teamId: result.team.id,
        teamName: result.team.name,
        accessToken: result.access_token,
        webhookUrl: result.incoming_webhook?.url,
        channel: result.incoming_webhook?.channel,
      },
      update: {
        teamId: result.team.id,
        teamName: result.team.name,
        accessToken: result.access_token,
        webhookUrl: result.incoming_webhook?.url,
        channel: result.incoming_webhook?.channel,
      },
    });

    res.redirect(`${env.frontendUrl}/dashboard?slack=connected`);
  } catch (err) {
    console.error("[slack] callback failed", (err as Error).message);
    res.redirect(`${env.frontendUrl}/dashboard?slack=error`);
  }
});

slackRouter.get("/status", requireAuth, async (req, res) => {
  const integration = await prisma.slackIntegration.findUnique({ where: { userId: req.userId } });
  res.json({ connected: Boolean(integration), teamName: integration?.teamName ?? null });
});

slackRouter.post("/disconnect", requireAuth, async (req, res) => {
  await prisma.slackIntegration.deleteMany({ where: { userId: req.userId } });
  res.json({ ok: true });
});
