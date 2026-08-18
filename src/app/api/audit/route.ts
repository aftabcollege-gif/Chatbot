import { NextRequest, NextResponse } from "next/server";
import { eq, and, desc, gte } from "drizzle-orm";
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
  const limitParam = parseInt(url.searchParams.get("limit") ?? "50");
  const limit = Math.min(limitParam, 200);

  const logs = await db
    .select()
    .from(auditLogs)
    .where(
      user.organizationId
        ? eq(auditLogs.organizationId, user.organizationId)
        : undefined
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);

  return NextResponse.json(logs);
}
