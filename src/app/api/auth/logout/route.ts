import { NextRequest, NextResponse } from "next/server";
import { revokeSession } from "@/lib/auth-server";
import { logEvent } from "@/lib/audit";
import { getUserIdFromRequest } from "@/lib/auth-server";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const token = request.cookies.get("access_token")?.value;
  const userId = await getUserIdFromRequest(request);

  if (token) {
    await revokeSession(token);
  }

  if (userId) {
    await logEvent({
      eventCode: "LOGOUT",
      actorId: userId,
      outcome: "SUCCESS",
      request,
    });
  }

  const response = NextResponse.json({ success: true });
  response.cookies.delete("access_token");
  return response;
}
