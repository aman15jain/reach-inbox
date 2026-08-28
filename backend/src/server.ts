import { createApp } from "./app";
import { env } from "./config/env";
import { ensureEmailIndex } from "./services/elasticsearch";
import { reconcileScheduledEmails } from "./services/reconcile";

async function main() {
  await ensureEmailIndex();
  await reconcileScheduledEmails();

  const app = createApp();
  app.listen(env.port, () => {
    console.log(`[server] listening on http://localhost:${env.port}`);
    console.log(`[server] Bull Board on http://localhost:${env.port}/admin/queues`);
  });
}

main().catch((err) => {
  console.error("[server] fatal error", err);
  process.exit(1);
});
