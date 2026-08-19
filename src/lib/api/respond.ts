import { NextResponse } from "next/server";
import { LocalLlmUnavailableError } from "@/lib/ai/types";
import { ForbiddenError } from "@/lib/auth/rbac";

export function jsonError(message: string, status = 400, extra?: Record<string, unknown>) {
  return NextResponse.json({ error: message, ...extra }, { status });
}

export function handleApiError(err: unknown): NextResponse {
  if (err instanceof LocalLlmUnavailableError) {
    return NextResponse.json(
      {
        error: "LOCAL_LLM_UNAVAILABLE",
        message: err.messageFa,
        detail: err.message,
      },
      { status: 503 },
    );
  }
  if (err instanceof ForbiddenError) {
    return jsonError(err.message, 403);
  }
  console.error("[api] unhandled error", err);
  const message = err instanceof Error ? err.message : "خطای غیرمنتظره سرور";
  return jsonError(message, 500);
}
