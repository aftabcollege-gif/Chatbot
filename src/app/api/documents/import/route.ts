import { NextRequest, NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { getCurrentUser, hasPermission } from "@/lib/auth-server";
import { PERMISSIONS } from "@/lib/permissions";
import { importFolder } from "@/lib/documents/bulk-import";
import { getQueueStats } from "@/lib/jobs/queue";
import { workerStatus } from "@/lib/jobs/worker";
import { logEvent } from "@/lib/audit";

export const dynamic = "force-dynamic";

const ImportSchema = z.object({
  /** Absolute path on the SERVER (the machine running the app). */
  sourceDir: z.string().min(1).max(2000),
  mode: z.enum(["copy", "link"]).default("copy"),
  extensions: z.array(z.string().min(1).max(10)).max(30).optional(),
  limit: z.number().int().min(1).max(1_000_000).optional(),
  dryRun: z.boolean().default(false),
});

interface ActiveImport {
  startedAt: number;
  /** Set when the scan promise settles; finished entries linger for a minute. */
  finishedAt: number | null;
  sourceDir: string;
  controller: AbortController;
  last: unknown;
}

const globalForImports = globalThis as typeof globalThis & {
  __activeImports?: Map<string, ActiveImport>;
};
const activeImports = (globalForImports.__activeImports ??= new Map());

/**
 * GET — import batches + live queue status (admin dashboard).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.ADMIN_SYSTEM)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  const batches = await db.execute(sql`
    SELECT id, source_path, status, total_files, imported_files, skipped_files, failed_files, error, started_at, finished_at
    FROM import_batches
    WHERE organization_id = ${user.organizationId}
    ORDER BY started_at DESC
    LIMIT 20
  `);

  return NextResponse.json({
    queue: await getQueueStats(user.organizationId),
    worker: workerStatus(),
    active: Array.from(activeImports.entries()).map(([id, v]) => ({
      id,
      sourceDir: v.sourceDir,
      startedAt: new Date(v.startedAt).toISOString(),
      finishedAt: v.finishedAt ? new Date(v.finishedAt).toISOString() : null,
      running: !v.finishedAt,
      progress: v.last,
    })),
    batches: (batches as unknown as { rows: unknown[] }).rows,
  });
}

/**
 * POST — start a server-side folder import. Returns immediately; the scan
 * runs in the background and the ingestion queue drains via the worker.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.ADMIN_SYSTEM) || !hasPermission(user, PERMISSIONS.DOCUMENT_CREATE)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  if (!user.organizationId) {
    return NextResponse.json({ error: "کاربر به سازمانی تعلق ندارد" }, { status: 400 });
  }

  const parsed = ImportSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: "پارامترهای ورودی نامعتبر است" }, { status: 400 });
  }
  const input = parsed.data;

  // Only one scan at a time — but finished entries linger in the map for a
  // minute so the dashboard can show their final progress; they must not
  // block the next import.
  const running = Array.from(activeImports.values()).some((entry) => !entry.finishedAt);
  if (running) {
    return NextResponse.json({ error: "یک عملیات واردکردن دیگر در حال اجراست. لطفاً تا پایان آن صبر کنید." }, { status: 409 });
  }

  const importId = crypto.randomUUID();
  const controller = new AbortController();
  const entry: ActiveImport = {
    startedAt: Date.now(),
    finishedAt: null,
    sourceDir: input.sourceDir,
    controller,
    last: null,
  };
  activeImports.set(importId, entry);

  await logEvent({
    eventCode: "DOCUMENT_BULK_IMPORT",
    actorId: user.id,
    actorName: user.name,
    organizationId: user.organizationId,
    resourceType: "import_batch",
    resourceId: importId,
    resourceName: input.sourceDir,
    outcome: "SUCCESS",
    metadata: { mode: input.mode, dryRun: input.dryRun, limit: input.limit ?? null },
    request,
  });

  void importFolder({
    organizationId: user.organizationId,
    departmentId: user.departmentId,
    uploadedBy: user.id,
    sourceDir: input.sourceDir,
    mode: input.mode,
    extensions: input.extensions,
    limit: input.limit,
    dryRun: input.dryRun,
    signal: controller.signal,
    onProgress: (p) => {
      entry.last = p;
    },
  })
    .then((result) => {
      console.log("[import] finished", result);
    })
    .catch((error) => {
      console.error("[import] failed", error);
      entry.last = { error: error instanceof Error ? error.message : String(error) };
    })
    .finally(() => {
      entry.finishedAt = Date.now();
      // Keep the final progress visible for a minute, then forget it.
      setTimeout(() => activeImports.delete(importId), 60_000).unref?.();
    });

  return NextResponse.json({ importId, started: true }, { status: 202 });
}

/** DELETE — cancel the running import (already-queued jobs keep processing). */
export async function DELETE(request: NextRequest): Promise<NextResponse> {
  const user = await getCurrentUser(request);
  if (!user) return NextResponse.json({ error: "احراز هویت الزامی است" }, { status: 401 });
  if (!hasPermission(user, PERMISSIONS.ADMIN_SYSTEM)) {
    return NextResponse.json({ error: "دسترسی مجاز نیست" }, { status: 403 });
  }
  for (const entry of activeImports.values()) if (!entry.finishedAt) entry.controller.abort();
  return NextResponse.json({ cancelled: activeImports.size });
}
