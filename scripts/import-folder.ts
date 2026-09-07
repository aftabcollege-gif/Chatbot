#!/usr/bin/env -S npx tsx
/**
 * Bulk import a folder of documents (100k+ files) — offline CLI.
 *
 *   npx tsx scripts/import-folder.ts <folder> [options]
 *   npm run import -- <folder> [options]
 *
 * Options:
 *   --org <uuid|slug>      organisation (default: the first/only organisation)
 *   --department <uuid>    department to attach documents to
 *   --user <username>      uploader recorded on each document (default: none)
 *   --mode copy|link       copy files into STORAGE_DIR (default) or index in place
 *   --ext pdf,docx,txt     restrict to these extensions
 *   --limit N              stop after N files (smoke test)
 *   --dry-run              scan + hash only, no DB / storage writes
 *   --process              also run the ingestion worker in this process until
 *                          the queue is empty (use when the web server is not running)
 *   --concurrency N        worker slots when --process is given (default INGEST_CONCURRENCY)
 *
 * The script talks to the same PGlite database directory as the app
 * (PORTABLE_DATABASE_DIR). PGlite allows ONE writer process at a time, so:
 *   - if the app is running, run WITHOUT --process: the app's own worker
 *     drains the queue. (You still need the app stopped while scanning, or
 *     use POST /api/documents/import from the admin UI instead.)
 *   - if the app is stopped, add --process to ingest everything here.
 */
import fs from "node:fs";
import path from "node:path";
import { config as loadEnv } from "dotenv";

loadEnv({ path: path.resolve(process.cwd(), ".env") });

interface Args {
  folder: string;
  org?: string;
  department?: string;
  user?: string;
  mode: "copy" | "link";
  ext?: string[];
  limit?: number;
  dryRun: boolean;
  process: boolean;
  concurrency?: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { folder: "", mode: "copy", dryRun: false, process: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "--org": args.org = next(); break;
      case "--department": args.department = next(); break;
      case "--user": args.user = next(); break;
      case "--mode": {
        const m = next();
        if (m !== "copy" && m !== "link") throw new Error("--mode must be copy or link");
        args.mode = m;
        break;
      }
      case "--ext": args.ext = next().split(",").map((s) => s.trim().toLowerCase()).filter(Boolean); break;
      case "--limit": args.limit = Number(next()); break;
      case "--dry-run": args.dryRun = true; break;
      case "--process": args.process = true; break;
      case "--concurrency": args.concurrency = Number(next()); break;
      case "-h":
      case "--help":
        console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("*/")[0]);
        process.exit(0);
      default:
        if (a.startsWith("--")) throw new Error(`Unknown option ${a}`);
        args.folder = a;
    }
  }
  if (!args.folder) throw new Error("Usage: import-folder.ts <folder> [options]");
  return args;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.concurrency) process.env.INGEST_CONCURRENCY = String(args.concurrency);

  const { ensureDatabaseMigrated } = await import("@/db/migrate");
  await ensureDatabaseMigrated();

  const { db, client } = await import("@/db");
  const { organizations, users } = await import("@/db/schema");
  const { eq, or } = await import("drizzle-orm");
  const { importFolder } = await import("@/lib/documents/bulk-import");
  const { getQueueStats } = await import("@/lib/jobs/queue");

  // Resolve organisation.
  const orgRows = args.org
    ? await db.select().from(organizations).where(or(eq(organizations.id, args.org), eq(organizations.slug, args.org))).limit(1)
    : await db.select().from(organizations).limit(2);
  if (orgRows.length === 0) throw new Error("No organisation found. Complete the setup wizard first.");
  if (!args.org && orgRows.length > 1) throw new Error("Multiple organisations exist — pass --org <uuid|slug>.");
  const org = orgRows[0];

  let uploadedBy: string | null = null;
  if (args.user) {
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.username, args.user)).limit(1);
    if (!u) throw new Error(`User ${args.user} not found`);
    uploadedBy = u.id;
  }

  console.log(`[import] organisation: ${org.name} (${org.id})`);
  console.log(`[import] folder: ${path.resolve(args.folder)}  mode=${args.mode}${args.dryRun ? "  DRY RUN" : ""}`);

  const controller = new AbortController();
  process.on("SIGINT", () => {
    console.log("\n[import] cancelling…");
    controller.abort();
  });

  let lastLine = 0;
  const result = await importFolder({
    organizationId: org.id,
    departmentId: args.department ?? null,
    uploadedBy,
    sourceDir: args.folder,
    mode: args.mode,
    extensions: args.ext,
    limit: args.limit,
    dryRun: args.dryRun,
    signal: controller.signal,
    progressEvery: 200,
    onProgress: (p) => {
      const now = Date.now();
      if (now - lastLine < 500 && p.scanned % 1000 !== 0) return;
      lastLine = now;
      const rate = p.scanned / Math.max(1, p.elapsedMs / 1000);
      process.stdout.write(
        `\r[import] scanned ${p.scanned}  imported ${p.imported}  dup ${p.skippedDuplicate}  unsupported ${p.skippedUnsupported}  large ${p.skippedTooLarge}  failed ${p.failed}  ${fmtBytes(p.bytes)}  ${rate.toFixed(0)} files/s   `,
      );
    },
  });
  process.stdout.write("\n");
  console.log(`[import] done in ${(result.elapsedMs / 1000).toFixed(1)}s — ${result.imported} documents queued for ingestion.`);

  if (args.process && !args.dryRun) {
    const { startJobWorker, stopJobWorker, workerStatus } = await import("@/lib/jobs/worker");
    startJobWorker();
    console.log("[import] processing queue in this process (Ctrl+C to stop; remaining jobs resume next start)…");
    const started = Date.now();
    let lastCompleted = -1;
    // Poll until the queue is empty and no job is running.
    for (;;) {
      await new Promise((r) => setTimeout(r, 2000));
      const stats = await getQueueStats(org.id);
      const ws = workerStatus();
      if (stats.completed !== lastCompleted) {
        lastCompleted = stats.completed;
        const elapsed = (Date.now() - started) / 1000;
        const donePerMin = (stats.completed / Math.max(1, elapsed)) * 60;
        const etaMin = donePerMin > 0 ? stats.pending / donePerMin : Number.POSITIVE_INFINITY;
        process.stdout.write(
          `\r[ingest] pending ${stats.pending}  running ${ws.running}/${ws.concurrency}  completed ${stats.completed}  failed ${stats.failed}  ${donePerMin.toFixed(1)} docs/min  ETA ${Number.isFinite(etaMin) ? etaMin.toFixed(0) + " min" : "—"}   `,
        );
      }
      if (stats.pending === 0 && stats.processing === 0 && ws.running === 0) break;
      if (controller.signal.aborted) break;
    }
    stopJobWorker();
    process.stdout.write("\n");
    console.log("[ingest] queue drained.");
  } else if (!args.dryRun) {
    const stats = await getQueueStats(org.id);
    console.log(`[import] queue: pending ${stats.pending}, processing ${stats.processing}, completed ${stats.completed}, failed ${stats.failed}`);
    console.log("[import] start the app (or re-run with --process) to ingest the queued documents.");
  }

  await client.close();
}

main().catch((error) => {
  console.error("\n[import] error:", error instanceof Error ? error.message : error);
  process.exit(1);
});
