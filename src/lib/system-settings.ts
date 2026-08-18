/**
 * System Settings — DB-backed runtime configuration (directive §35, §49)
 *
 * A small set of RAG tuning knobs are safely hot-configurable by an admin
 * without a restart (top_k, min_score). Everything else that affects
 * process-level behavior (model paths, ports, secrets) is intentionally
 * environment-variable-only and requires a service restart — this is a
 * deliberate "Configuration over Hardcoding, Fail Fast" choice (directive
 * §10/§38): silently hot-swapping a model path from a web form without
 * checksum re-verification (§14) would be unsafe.
 */

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { systemSettings } from "@/db/schema";

export interface RagSettings {
  topK: number;
  minScore: number;
}

export async function getRagSettings(): Promise<RagSettings> {
  const rows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "rag.top_k"));
  const topKRow = rows[0];

  const minRows = await db
    .select()
    .from(systemSettings)
    .where(eq(systemSettings.key, "rag.min_score"));
  const minScoreRow = minRows[0];

  const topK =
    typeof topKRow?.value === "number"
      ? topKRow.value
      : parseInt(process.env.RAG_TOP_K ?? "8");
  const minScore =
    typeof minScoreRow?.value === "number"
      ? minScoreRow.value
      : parseFloat(process.env.RAG_MIN_SCORE ?? "0.1");

  return { topK, minScore };
}

export async function updateRagSettings(
  values: Partial<RagSettings>,
  updatedBy: string
): Promise<void> {
  if (typeof values.topK === "number") {
    await db
      .insert(systemSettings)
      .values({ key: "rag.top_k", value: values.topK, category: "rag", updatedBy })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: values.topK, updatedBy, updatedAt: new Date() },
      });
  }
  if (typeof values.minScore === "number") {
    await db
      .insert(systemSettings)
      .values({ key: "rag.min_score", value: values.minScore, category: "rag", updatedBy })
      .onConflictDoUpdate({
        target: systemSettings.key,
        set: { value: values.minScore, updatedBy, updatedAt: new Date() },
      });
  }
}
