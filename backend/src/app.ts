import express from "express";
import cors from "cors";
import passport from "passport";
import { createBullBoard } from "@bull-board/api";
import { BullMQAdapter } from "@bull-board/api/bullMQAdapter";
import { ExpressAdapter } from "@bull-board/express";
import { env } from "./config/env";
import { configurePassport } from "./passport/google";
import { emailQueue } from "./queues/emailQueue";
import { authRouter } from "./routes/auth";
import { sendersRouter } from "./routes/senders";
import { emailsRouter } from "./routes/emails";
import { slackRouter } from "./routes/slack";

export function createApp() {
  configurePassport();

  const app = express();
  // No `credentials: true` needed — auth is a Bearer token in the
  // Authorization header, not a cookie, so there's nothing cross-site
  // cookie policy needs to allow.
  app.use(cors({ origin: env.frontendUrl }));
  app.use(express.json());
  app.use(passport.initialize());

  const serverAdapter = new ExpressAdapter();
  serverAdapter.setBasePath("/admin/queues");
  createBullBoard({ queues: [new BullMQAdapter(emailQueue)], serverAdapter });
  // Live queue visibility as required by the spec — waiting/active/delayed/
  // completed/failed jobs, retry/remove controls, all for free from BullMQ.
  app.use("/admin/queues", serverAdapter.getRouter());

  app.get("/api/health", (_req, res) => res.json({ ok: true }));

  app.use("/api/auth", authRouter);
  app.use("/api/senders", sendersRouter);
  app.use("/api/emails", emailsRouter);
  app.use("/api/slack", slackRouter);

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[app] unhandled error", err);
    res.status(500).json({ error: "Internal server error" });
  });

  return app;
}
