import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc, gte, count } from "drizzle-orm";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.AUDIT_READ)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const url = new URL(request.url);
  const limitParam = parseInt(url.searchParams.get("limit") ?? "50", 10);
  const limit = Math.min(Math.max(Number.isFinite(limitParam) ? limitParam : 50, 1), 200);
  const offsetParam = parseInt(url.searchParams.get("offset") ?? "0", 10);
  const offset = Math.max(Number.isFinite(offsetParam) ? offsetParam : 0, 0);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : null;

  const conditions = [
    user.organizationId ? eq(auditLogs.organizationId, user.organizationId) : undefined,
    since && !Number.isNaN(since.getTime()) ? gte(auditLogs.createdAt, since) : undefined,
  ].filter((c): c is NonNullable<typeof c> => Boolean(c));
  const where = conditions.length > 0 ? and(...conditions) : undefined;

  // Page + total in parallel; both are index-backed (audit_logs_org_created_idx).
  const [logs, [{ total }]] = await Promise.all([
    db.select().from(auditLogs).where(where).orderBy(desc(auditLogs.createdAt)).limit(limit).offset(offset),
    db.select({ total: count() }).from(auditLogs).where(where),
  ]);

  // Response stays a plain array for the existing admin pages; paging
  // metadata travels in headers.
  const response = NextResponse.json(logs);
  response.headers.set("X-Total-Count", String(total));
  response.headers.set("X-Has-More", String(offset + logs.length < Number(total)));
  return response;
}
