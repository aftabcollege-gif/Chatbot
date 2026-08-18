import { NextRequest, NextResponse } from "next/server";
import { processNextJob } from "@/lib/document-processor";

export const dynamic = "force-dynamic";

// This endpoint is called by an internal scheduler or cron job
// It processes the next pending job in the queue
// Protected by a simple shared secret (not JWT — called by scheduler, not users)
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = request.headers.get("x-job-secret");
  const expectedSecret = process.env.JOB_SECRET ?? "internal-job-secret";

  if (secret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const processed = await processNextJob();
    return NextResponse.json({ processed });
  } catch (error) {
    console.error("[JobRunner] Error:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Job processing failed" },
      { status: 500 }
    );
  }
}
