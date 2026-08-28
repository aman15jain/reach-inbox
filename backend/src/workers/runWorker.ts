import { createEmailWorker } from "./emailWorker";
import { ensureEmailIndex } from "../services/elasticsearch";
import { reconcileScheduledEmails } from "../services/reconcile";

async function main() {
  await ensureEmailIndex();
  await reconcileScheduledEmails();
  const worker = createEmailWorker();
  console.log(`[worker] email worker started (concurrency=${worker.opts.concurrency})`);

  process.on("SIGTERM", async () => {
    await worker.close();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[worker] fatal error", err);
  process.exit(1);
});
