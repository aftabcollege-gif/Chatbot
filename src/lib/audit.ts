import type { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

interface LogEventInput {
  eventCode: string;
  actorId?: string | null;
  actorName?: string | null;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  request?: NextRequest;
  metadata?: Record<string, unknown>;
}

export async function logEvent(input: LogEventInput) {
  try {
    await db.insert(auditLogs).values({
      eventCode: input.eventCode,
      actorId: input.actorId || null,
      actorName: input.actorName || null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceName: input.resourceName,
      ipAddress: input.request?.headers.get("x-forwarded-for") || undefined,
      userAgent: input.request?.headers.get("user-agent") || undefined,
      metadata: input.metadata || {},
    });
  } catch (error) {
    // Audit logging must never break the primary request flow.
    console.error("Failed to write audit log:", error);
  }
}
