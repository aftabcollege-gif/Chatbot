import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { getAIStatus } from "@/lib/ai/orchestrator";
import { getRagSettings, updateRagSettings } from "@/lib/system-settings";
import { logEvent } from "@/lib/audit";
import { z } from "zod";

export const dynamic = "force-dynamic";

/**
 * Real (non-mocked) system status + configuration for the admin settings
 * screen. LLM/embedding provider identity and availability are queried live
 * from the AI orchestrator (directive §40 observability) — never hardcoded.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.ADMIN_SYSTEM)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const [aiStatus, ragSettings] = await Promise.all([getAIStatus(), getRagSettings()]);

  return NextResponse.json({
    ai: aiStatus,
    rag: ragSettings,
    // Read-only — process-level, env-configured, requires restart to change
    // (directive §14/§38: no silent hot-swap of model/security configuration).
    env: {
      ollamaBaseUrl: process.env.OLLAMA_BASE_URL ?? "http://localhost:11434",
      llmModel: process.env.OLLAMA_LLM_MODEL ?? "qwen2.5:7b",
      embedModel: process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text",
      embeddingDimensions: parseInt(process.env.EMBEDDING_DIMENSIONS ?? "768"),
      sessionDurationHours: parseInt(process.env.SESSION_DURATION_HOURS ?? "8"),
      maxFileSizeMb: parseInt(process.env.MAX_FILE_SIZE_MB ?? "50"),
      allowedFileExtensions: process.env.ALLOWED_FILE_EXTENSIONS ?? "pdf,docx,txt,md",
      offlineMode: true,
    },
  });
}

const UpdateSchema = z.object({
  topK: z.number().int().min(1).max(50).optional(),
  minScore: z.number().min(0).max(1).optional(),
});

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.ADMIN_SYSTEM)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const parsed = UpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "مقادیر نامعتبر" }, { status: 400 });
  }

  await updateRagSettings(parsed.data, user.id);

  await logEvent({
    eventCode: "SETTING_CHANGE",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId ?? undefined,
    resourceType: "system_setting",
    metadata: parsed.data,
  });

  return NextResponse.json({ success: true, rag: await getRagSettings() });
}
