#!/usr/bin/env node
/* Offline portable entry point.
 *
 * Run this instead of calling `next start` directly. It
 *   1. verifies that the self-contained bundle is complete (build, deps,
 *      optional models) and prints actionable Persian/English messages;
 *   2. repairs the hashed Turbopack external aliases (see
 *      repair-pglite-external.cjs) before Next.js evaluates instrumentation;
 *   3. puts the bundled poppler (pdftoppm, used for scanned-PDF OCR) on PATH;
 *   4. starts Next.js in production mode bound to localhost only and forwards
 *      Ctrl+C / window close so PGlite shuts down cleanly.
 */
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");

function fail(message) {
  console.error(`\n[portable] ${message}\n`);
  process.exit(1);
}

/** Minimal .env reader (KEY=VALUE, # comments, optional quotes) — no deps. */
function readDotEnv(file) {
  const values = {};
  if (!fs.existsSync(file)) return values;
  for (const rawLine of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

// ---------------------------------------------------------------------------
// 1. Preflight
// ---------------------------------------------------------------------------
const nextBin = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
if (!fs.existsSync(path.join(projectRoot, ".next", "BUILD_ID"))) {
  fail("Production build (.next) is missing. Reinstall the application — do not copy only the portable_bild folder.");
}
if (!fs.existsSync(nextBin)) {
  fail("node_modules is missing or incomplete. Reinstall the application; do not run npm install while offline.");
}
if (!fs.existsSync(path.join(projectRoot, ".env"))) {
  // Start-Portable.bat normally generates it; handle a direct `node` start too.
  const create = childProcess.spawnSync(
    process.execPath,
    [path.join(__dirname, "create-portable-env.cjs"), path.join(projectRoot, ".env"), path.join(__dirname, ".env.template")],
    { cwd: projectRoot, stdio: "inherit" },
  );
  if (create.status !== 0) fail("Could not create .env from portable_bild/.env.template.");
}

const major = Number(process.versions.node.split(".")[0]);
if (major < 20) {
  fail(`Node.js ${process.versions.node} is too old; the bundled runtime must be Node.js 20 or newer.`);
}

// Next.js only loads .env after it has started, but the launcher needs PORT and
// the bind address before that — real environment variables win over .env.
const dotEnv = readDotEnv(path.join(projectRoot, ".env"));
const port = process.env.PORT || dotEnv.PORT || "3800";
// Portable installs are single-machine by default; set PORTABLE_HOSTNAME=0.0.0.0
// in .env to expose the app on the LAN.
const hostname = process.env.PORTABLE_HOSTNAME || dotEnv.PORTABLE_HOSTNAME || "127.0.0.1";

// ---------------------------------------------------------------------------
// 2. Repair hashed externals (idempotent, offline)
// ---------------------------------------------------------------------------
const repair = path.join(__dirname, "repair-pglite-external.cjs");
const repairResult = childProcess.spawnSync(process.execPath, [repair, projectRoot], {
  cwd: projectRoot,
  stdio: "inherit",
});
if (repairResult.status !== 0) process.exit(repairResult.status || 1);

// ---------------------------------------------------------------------------
// 3. Environment for the server process
// ---------------------------------------------------------------------------
const env = { ...process.env, PORT: port, HOSTNAME: hostname, NODE_ENV: "production" };

// node-llama-cpp must never try to download/build llama.cpp on an offline box.
env.NODE_LLAMA_CPP_SKIP_DOWNLOAD = env.NODE_LLAMA_CPP_SKIP_DOWNLOAD || "true";
// Next.js telemetry is opt-out; keep the machine silent.
env.NEXT_TELEMETRY_DISABLED = env.NEXT_TELEMETRY_DISABLED || "1";

// Bundled poppler (Windows build) → PATH so `pdftoppm` resolves for OCR of
// scanned PDFs. On Linux/macOS the system package is used if present.
const popplerBin = path.join(__dirname, "poppler", "bin");
if (fs.existsSync(popplerBin)) {
  env.PATH = `${popplerBin}${path.delimiter}${env.PATH || ""}`;
}

// Report which optional offline assets are present so first-run users know
// what to expect (the app still works without models: extractive answers +
// keyword search).
const models = {
  "LLM (models/llm/model.gguf)": path.join(projectRoot, "models", "llm", "model.gguf"),
  "Embeddings (models/embeddings/model.gguf)": path.join(projectRoot, "models", "embeddings", "model.gguf"),
  "OCR Persian (fas.traineddata[.gz])": [
    path.join(projectRoot, "models", "ocr", "tessdata", "fas.traineddata.gz"),
    path.join(projectRoot, "models", "ocr", "tessdata", "fas.traineddata"),
  ],
  "OCR English (eng.traineddata[.gz])": [
    path.join(projectRoot, "models", "ocr", "tessdata", "eng.traineddata.gz"),
    path.join(projectRoot, "models", "ocr", "tessdata", "eng.traineddata"),
  ],
  "poppler (pdftoppm for scanned PDFs)": [path.join(popplerBin, "pdftoppm.exe"), path.join(popplerBin, "pdftoppm")],
};
console.log("[portable] Offline assets:");
for (const [label, candidates] of Object.entries(models)) {
  const list = Array.isArray(candidates) ? candidates : [candidates];
  const present = list.some((p) => fs.existsSync(p));
  console.log(`  ${present ? "✓" : "–"} ${label}${present ? "" : "  (not bundled — feature runs in fallback mode)"}`);
}
console.log(`[portable] Starting Next.js on http://${hostname === "0.0.0.0" ? "localhost" : hostname}:${port} …`);

// ---------------------------------------------------------------------------
// 4. Start the production server
// ---------------------------------------------------------------------------
const server = childProcess.spawn(process.execPath, [nextBin, "start", "-p", port, "-H", hostname], {
  cwd: projectRoot,
  env,
  stdio: "inherit",
  windowsHide: false,
});

let shuttingDown = false;
function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`\n[portable] ${signal} received — stopping the server …`);
  server.kill("SIGTERM");
  // Give PGlite/Next a moment to flush, then force.
  setTimeout(() => {
    if (server.exitCode === null) server.kill("SIGKILL");
  }, 8000).unref();
}
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP", "SIGBREAK"]) {
  try {
    process.on(signal, () => shutdown(signal));
  } catch {
    /* SIGBREAK only exists on Windows */
  }
}

server.on("error", (error) => {
  console.error("[portable] Unable to start Next.js:", error.message);
  process.exit(1);
});
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
