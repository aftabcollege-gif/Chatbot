import { NextRequest, NextResponse } from "next/server";
import { processPendingJobOnce } from "@/lib/jobs/worker";

export const dynamic = "force-dynamic";

// FAIL FAST: no insecure default secret (directive §37/§38).
const expectedSecret = process.env.JOB_SECRET;
if (!expectedSecret || expectedSecret.length < 16) {
  throw new Error("JOB_SECRET must be set and at least 16 characters long");
}

// This endpoint is called by an internal scheduler or cron job
// It processes the next pending job in the queue
// Protected by a simple shared secret (not JWT — called by scheduler, not users)
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = request.headers.get("x-job-secret");

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const processed = await processPendingJobOnce();
    return NextResponse.json({ processed });
  } catch (error) {
    console.error("[JobRunner] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job processing failed" },
      { status: 500 }
    );
  }
}
