import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { sessions, users } from "@/db/schema";
import { eq } from "drizzle-orm";
import { jwtVerify } from "jose";
import { logEvent } from "@/lib/audit";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "change-this-to-random-64-char-string"
);

export async function POST(request: NextRequest) {
  try {
    const token = request.cookies.get("access_token")?.value;

    if (token) {
      try {
        const { payload } = await jwtVerify(token, JWT_SECRET);
        const userId = payload.userId as string;
        await db.delete(sessions).where(eq(sessions.userId, userId));
        const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
        await logEvent({ eventCode: "auth.logout", actorId: userId, actorName: user?.name, request });
      } catch {
        // Token invalid, just clear cookies
      }
    }

    const response = NextResponse.json({ success: true });
    
    response.cookies.delete("access_token");
    response.cookies.delete("refresh_token");

    return response;
  } catch (error) {
    console.error("Logout error:", error);
    return NextResponse.json({ success: true });
  }
}
