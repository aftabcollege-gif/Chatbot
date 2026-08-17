import { NextResponse } from "next/server";
import { db } from "@/db";
import { setupStatus, users } from "@/db/schema";
import { count } from "drizzle-orm";

export async function GET() {
  try {
    // Check if setup_status table exists and has a record
    const [status] = await db.select().from(setupStatus).limit(1);
    
    if (status?.completed) {
      return NextResponse.json({ completed: true, currentStep: 8 });
    }

    // Check if any admin user exists
    const [userCount] = await db.select({ count: count() }).from(users);
    
    if (userCount.count > 0) {
      // Mark setup as completed
      if (!status) {
        await db.insert(setupStatus).values({
          id: 1,
          completed: true,
          currentStep: 8,
          completedAt: new Date(),
        });
      } else {
        // Update is not needed, setup is complete if users exist
      }
      return NextResponse.json({ completed: true, currentStep: 8 });
    }

    return NextResponse.json({
      completed: false,
      currentStep: status?.currentStep || 1,
    });
  } catch (error) {
    // Tables might not exist yet
    console.error("Setup status error:", error);
    return NextResponse.json({ completed: false, currentStep: 1 });
  }
}
