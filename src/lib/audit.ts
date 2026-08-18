import type { NextRequest } from "next/server";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";

export type AuditEventCode =
  // Auth events
  | "LOGIN"
  | "FAILED_LOGIN"
  | "LOGOUT"
  | "SESSION_EXPIRED"
  | "ACCOUNT_LOCKED"
  // User events
  | "USER_CREATE"
  | "USER_UPDATE"
  | "USER_DELETE"
  | "USER_ACTIVATE"
  | "USER_DEACTIVATE"
  | "ROLE_ASSIGN"
  | "ROLE_REVOKE"
  | "PASSWORD_CHANGE"
  | "PASSWORD_RESET"
  // Permission events
  | "PERMISSION_CHANGE"
  | "SETTING_CHANGE"
  // Document events
  | "DOCUMENT_UPLOAD"
  | "DOCUMENT_VIEW"
  | "DOCUMENT_DOWNLOAD"
  | "DOCUMENT_DELETE"
  | "DOCUMENT_ARCHIVE"
  | "DOCUMENT_PROCESS_START"
  | "DOCUMENT_PROCESS_COMPLETE"
  | "DOCUMENT_PROCESS_FAIL"
  | "DOCUMENT_REINDEX"
  // Knowledge events
  | "KNOWLEDGE_CREATE"
  | "KNOWLEDGE_UPDATE"
  | "KNOWLEDGE_SUBMIT"
  | "KNOWLEDGE_REVIEW"
  | "KNOWLEDGE_APPROVE"
  | "KNOWLEDGE_REJECT"
  | "KNOWLEDGE_PUBLISH"
  | "KNOWLEDGE_ARCHIVE"
  | "KNOWLEDGE_DELETE"
  // Experience events
  | "EXPERIENCE_CREATE"
  | "EXPERIENCE_UPDATE"
  | "EXPERIENCE_SUBMIT"
  | "EXPERIENCE_REVIEW"
  | "EXPERIENCE_APPROVE"
  | "EXPERIENCE_REJECT"
  | "EXPERIENCE_PUBLISH"
  | "EXPERIENCE_ARCHIVE"
  | "EXPERIENCE_DELETE"
  // Chat events
  | "CHAT_CREATE"
  | "CHAT_MESSAGE"
  | "CHAT_DELETE"
  | "SOURCE_VIEW"
  | "FEEDBACK_SUBMIT"
  // Admin events
  | "ADMIN_ACCESS"
  | "BACKUP_CREATE"
  | "BACKUP_RESTORE"
  | "REINDEX_START"
  | "REINDEX_COMPLETE"
  // System events
  | "SYSTEM_START"
  | "SETUP_COMPLETE"
  | "HEALTH_CHECK";

interface LogEventInput {
  eventCode: AuditEventCode;
  actorId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  organizationId?: string | null;
  resourceType?: string;
  resourceId?: string;
  resourceName?: string;
  request?: NextRequest;
  outcome?: "SUCCESS" | "FAILURE" | "PARTIAL";
  severity?: "INFO" | "WARNING" | "ERROR" | "CRITICAL";
  metadata?: Record<string, unknown>;
}

export async function logEvent(input: LogEventInput): Promise<void> {
  try {
    await db.insert(auditLogs).values({
      eventCode: input.eventCode,
      actorId: input.actorId ?? null,
      actorName: input.actorName ?? null,
      actorRole: input.actorRole ?? null,
      organizationId: input.organizationId ?? null,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      resourceName: input.resourceName,
      ipAddress:
        input.request?.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
        input.request?.headers.get("x-real-ip") ??
        undefined,
      userAgent: input.request?.headers.get("user-agent") ?? undefined,
      outcome: input.outcome ?? "SUCCESS",
      severity: input.severity ?? "INFO",
      metadata: input.metadata ?? {},
    });
  } catch (error) {
    // Audit logging must NEVER break the primary request flow.
    // Log to stderr only.
    console.error("[AUDIT_FAIL]", input.eventCode, error);
  }
}
