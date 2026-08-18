import { db } from "@/db";
import { sql } from "drizzle-orm";
import { getAIStatus } from "@/lib/ai/orchestrator";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await db.execute(sql`select 1`);

    let aiStatus = null;
    try {
      aiStatus = await getAIStatus();
    } catch {
      // AI status check is non-critical
    }

    return Response.json({
      ok: true,
      database: "READY",
      ai: aiStatus,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return Response.json(
      {
        ok: false,
        database: "FAILED",
        error: err instanceof Error ? err.message : "Database connection failed",
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
