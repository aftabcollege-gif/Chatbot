import { NextResponse } from "next/server";
import { db } from "@/db";
import { setupStatus } from "@/db/schema";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    const [status] = await db.select().from(setupStatus).limit(1);
    return NextResponse.json({
      completed: status?.completed ?? false,
      currentStep: status?.currentStep ?? 1,
      organizationName: status?.organizationName ?? null,
    });
  } catch {
    return NextResponse.json({ completed: false, currentStep: 1 });
  }
}
