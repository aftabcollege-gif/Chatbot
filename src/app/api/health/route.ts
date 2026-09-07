import { sql } from "drizzle-orm";
import { db, isVectorSearchAvailable } from "@/db";
import { getQueueStats } from "@/lib/jobs/queue";
import { workerStatus } from "@/lib/jobs/worker";
import { isChatModelFilePresent, isEmbeddingModelFilePresent } from "@/lib/ai/llama-runtime";
import { authCacheStats } from "@/lib/auth-cache";
import { maintenanceStatus } from "@/lib/jobs/maintenance";
import { migrationState } from "@/db/migrate";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

/**
 * Liveness + readiness in one call (no authentication — it exposes no tenant
 * data, only process-level status). Used by the portable launcher to wait for
 * the server and by administrators to see at a glance whether ingestion is
 * running and which local models are installed.
 */
export async function GET() {
  const t0 = Date.now();
  try {
    await db.execute(sql`select 1`);
    const dbMs = Date.now() - t0;
    const migrations = migrationState();
    const schemaReady = migrations.status === "ok";
    const queue = schemaReady ? await getQueueStats().catch(() => null) : null;
    const worker = workerStatus();
    const memory = process.memoryUsage();

    // Only "ok" once the schema has been applied; a server whose migration
    // failed (e.g. incomplete installation) must not look healthy.
    return Response.json(
      {
        ok: schemaReady,
        uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
        database: { ok: true, latencyMs: dbMs, vectorSearch: isVectorSearchAvailable(), migrations },
        models: {
          llm: isChatModelFilePresent(),
          embedding: isEmbeddingModelFilePresent(),
        },
        ingestion: {
          workerStarted: worker.started,
          running: worker.running,
          concurrency: worker.concurrency,
          queue,
        },
        authCache: authCacheStats(),
        maintenance: maintenanceStatus(),
        memory: { rssMb: Math.round(memory.rss / 1048576), heapUsedMb: Math.round(memory.heapUsed / 1048576) },
      },
      { status: schemaReady ? 200 : 503 },
    );
  } catch (error) {
    return Response.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 },
    );
  }
}
