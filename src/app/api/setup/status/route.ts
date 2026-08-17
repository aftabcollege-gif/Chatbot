import { NextResponse } from "next/server";
import { db } from "@/db";
import { setupStatus, users } from "@/db/schema";
import { count } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const [status] = await db.select().from(setupStatus).limit(1);
    
    if (status?.completed) {
      return NextResponse.json({ completed: true, currentStep: 8 });
    }

    const [userCount] = await db.select({ count: count() }).from(users);
    
    if (userCount.count > 0) {
      if (!status) {
        await db.insert(setupStatus).values({
          id: 1,
          completed: true,
          currentStep: 8,
          completedAt: new Date(),
        });
      }
      return NextResponse.json({ completed: true, currentStep: 8 });
    }

    return NextResponse.json({
      completed: false,
      currentStep: status?.currentStep || 1,
    });
  } catch (error) {
    console.error("Setup status error:", error);
    return NextResponse.json({ completed: false, currentStep: 1 });
  }
}
