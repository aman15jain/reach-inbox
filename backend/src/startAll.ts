import { ChildProcess, spawn } from "child_process";
import path from "path";

/**
 * Render's free tier only runs one persistent web service (no separate
 * background worker product), but that one process is free to spawn real
 * child processes. This launcher starts the compiled Express API and the
 * compiled BullMQ worker as two independent `node` processes under a single
 * Render service — each is still a genuine, separate Node process with its
 * own event loop, not a merged-in-process hack — and forwards signals so
 * Render's restart/redeploy cycle stops both cleanly.
 *
 * Local dev is untouched: `npm run dev` / `npm run worker:dev` still start
 * them separately. This entrypoint (`npm run start:all`) only exists for
 * the single-Render-service production deployment.
 */

const GRACE_PERIOD_MS = 8000;

const children = new Map<string, ChildProcess>();
let shuttingDown = false;

function spawnChild(label: string, relativeScriptPath: string): void {
  const child = spawn(process.execPath, [path.join(__dirname, relativeScriptPath)], {
    stdio: "inherit",
    env: process.env,
  });
  children.set(label, child);

  child.on("exit", (code, signal) => {
    console.log(`[start-all] ${label} exited (code=${code}, signal=${signal})`);
    children.delete(label);

    if (shuttingDown) {
      // Part of an intentional shutdown — once every child has actually
      // exited, let the parent exit too.
      if (children.size === 0) process.exit(0);
      return;
    }

    // An unplanned crash: if either process dies unexpectedly, take the
    // sibling down too and exit non-zero, so Render's restart-on-crash
    // brings API + worker back up together instead of silently running
    // with a dead worker and a still-"healthy" API.
    beginShutdown(code ?? 1);
  });
}

function beginShutdown(exitCode: number) {
  if (shuttingDown) return;
  shuttingDown = true;

  if (children.size === 0) {
    process.exit(exitCode);
    return;
  }

  for (const child of children.values()) child.kill("SIGTERM");

  // Safety net: don't let a stuck child hang Render's shutdown indefinitely.
  setTimeout(() => {
    for (const child of children.values()) child.kill("SIGKILL");
    process.exit(exitCode);
  }, GRACE_PERIOD_MS).unref();
}

spawnChild("api", "server.js");
spawnChild("worker", "workers/runWorker.js");

process.on("SIGTERM", () => beginShutdown(0));
process.on("SIGINT", () => beginShutdown(0));
