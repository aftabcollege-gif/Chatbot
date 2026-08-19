import { db } from "@/db";
import { auditLogs } from "@/db/schema";

interface AuditEntry {
  organizationId?: string | null;
  userId?: string | null;
  action: string;
  resourceType?: string;
  resourceId?: string;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  requestId?: string;
}

// Audit logs must never contain full document text or secrets - only
// metadata describing the action.
export async function logAudit(entry: AuditEntry): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      organizationId: entry.organizationId ?? null,
      userId: entry.userId ?? null,
      action: entry.action,
      resourceType: entry.resourceType,
      resourceId: entry.resourceId,
      metadata: entry.metadata ?? {},
      ipAddress: entry.ipAddress ?? null,
      requestId: entry.requestId,
    });
  } catch (err) {
    // Audit logging failures must never break the primary request flow.
    console.error("[audit] failed to write audit log", err);
  }
}

export function ipFromRequest(request: Request): string | null {
  const forwardedFor = request.headers.get("x-forwarded-for");
  return forwardedFor?.split(",")[0]?.trim() ?? null;
}
