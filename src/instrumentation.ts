export async function register() {
  // Only start the background job worker in the real Node.js server runtime
  // (never during edge/middleware compilation or static analysis).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startJobWorker } = await import("@/lib/jobs/worker");
    startJobWorker();
  }
}
