import { NextRequest, NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);

  if (!user) {
    return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  }

  return NextResponse.json({
    id: user.id,
    name: user.name,
    email: user.email,
    username: user.username,
    organizationId: user.organizationId,
    departmentId: user.departmentId,
    isSuperadmin: user.isSuperadmin,
    roles: user.roles,
    permissions: Array.from(user.permissions),
    isAdmin: user.isAdmin,
  });
}
