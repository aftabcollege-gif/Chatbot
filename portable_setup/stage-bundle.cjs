#!/usr/bin/env node
/*
 * Assembles the self-contained application folder that the Windows installer
 * (and the portable ZIP) ship. Cross-platform on purpose: the same script is
 * used by portable_setup/build-installer.ps1 on Windows and by the automated
 * tests on Linux.
 *
 *   node stage-bundle.cjs <projectRoot> <stageDir> [options]
 *
 * Options:
 *   --platform win32|linux|darwin   native binaries to keep (default: win32)
 *   --arch x64|arm64                (default: x64)
 *   --skip-models                   do not fail when GGUF/OCR files are absent
 *   --gpu                           keep CUDA/Vulkan llama.cpp binaries
 *   --version <v>                   written to VERSION.txt
 *
 * The staged folder contains:
 *   .next/            production build (without cache/ and the dev-only
 *                     node_modules/ symlink folder)
 *   node_modules/     production dependencies for the target platform only,
 *                     plus real copies of the hashed Turbopack external aliases
 *   models/           GGUF + OCR data that exist in the source tree
 *   drizzle/          base SQL schema applied on first start
 *   portable_bild/    launcher scripts (+ runtime/ and poppler/ when present)
 *   package.json, .env.template, README-Setup.md, VERSION.txt, storage/README.txt
 *
 * It never contains a `.env` (secrets are generated on the target machine).
 */
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const positional = args.filter((a) => !a.startsWith("--"));
function option(name, fallback) {
  const idx = args.indexOf(name);
  return idx === -1 ? fallback : args[idx + 1];
}
const projectRoot = path.resolve(positional[0] || path.join(__dirname, ".."));
const stageDir = path.resolve(positional[1] || path.join(__dirname, "release", "app"));
const platform = option("--platform", "win32");
const arch = option("--arch", "x64");
const skipModels = args.includes("--skip-models");
const keepGpu = args.includes("--gpu");
let version = option("--version", process.env.PORTABLE_VERSION || "");

function fail(message) {
  console.error(`\n[stage] ERROR: ${message}\n`);
  process.exit(1);
}
function exists(p) {
  return fs.existsSync(p);
}
function dirSize(dir) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const p = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(p);
      else if (entry.isFile()) total += fs.statSync(p).size;
    }
  }
  return total;
}
const fmtGB = (bytes) => `${(bytes / 1024 ** 3).toFixed(2)} GB`;
const fmtMB = (bytes) => `${Math.round(bytes / 1024 ** 2)} MB`;

if (stageDir === projectRoot || projectRoot.startsWith(stageDir + path.sep)) fail("stage directory must be outside the project root");

// ---------------------------------------------------------------------------
// 1. Verify inputs
// ---------------------------------------------------------------------------
console.log(`[stage] project: ${projectRoot}`);
console.log(`[stage] target : ${platform}/${arch}${keepGpu ? " (+GPU)" : ""} → ${stageDir}`);

if (!version) {
  try {
    version = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8")).version || "";
  } catch {
    /* ignore */
  }
  if (!version) version = "1.0.0";
}

const portable = path.join(projectRoot, "portable_bild");
const required = [
  ".next/BUILD_ID",
  "node_modules/next/dist/bin/next",
  "node_modules/@electric-sql/pglite/package.json",
  "node_modules/@electric-sql/pglite-pgvector/package.json",
  "node_modules/node-llama-cpp/package.json",
  "package.json",
  "drizzle/0000_steady_stryfe.sql",
  "portable_bild/Start-Portable.bat",
  "portable_bild/start-portable.cjs",
  "portable_bild/repair-pglite-external.cjs",
  "portable_bild/create-portable-env.cjs",
  "portable_bild/open-browser.cjs",
  "portable_bild/.env.template",
];
const nativeByPlatform = {
  win32: ["node_modules/@node-llama-cpp/win-x64/package.json", "node_modules/@next/swc-win32-x64-msvc/package.json"],
  linux: ["node_modules/@node-llama-cpp/linux-x64/package.json", "node_modules/@next/swc-linux-x64-gnu/package.json"],
  darwin: [],
};
for (const rel of [...required, ...(nativeByPlatform[platform] || [])]) {
  if (!exists(path.join(projectRoot, rel))) fail(`required build input is missing: ${rel} (run npm ci + npm run build for ${platform}/${arch} first)`);
}

const modelChecks = [
  { rel: "models/llm/model.gguf", label: "LLM model" },
  { rel: "models/embeddings/model.gguf", label: "Embedding model" },
];
const summary = [];
for (const m of modelChecks) {
  const p = path.join(projectRoot, m.rel);
  if (exists(p)) summary.push(`✓ ${m.label} (${fmtMB(fs.statSync(p).size)})`);
  else if (skipModels) summary.push(`– ${m.label} missing (skip-models)`);
  else fail(`${m.label} (${m.rel}) is missing. Run "node scripts/install-model.mjs" or pass --skip-models.`);
}
const tess = (lang) => ["gz", ""].some((ext) => exists(path.join(projectRoot, "models/ocr/tessdata", `${lang}.traineddata${ext ? "." + ext : ""}`)));
if (tess("fas") && tess("eng")) summary.push("✓ OCR data (fas + eng)");
else if (skipModels) summary.push("– OCR data missing (skip-models)");
else fail('OCR data models/ocr/tessdata/{fas,eng}.traineddata[.gz] is missing. Run "node scripts/install-model.mjs --ocr" or pass --skip-models.');
if (platform === "win32") {
  if (exists(path.join(portable, "runtime", "node.exe"))) summary.push("✓ portable_bild/runtime/node.exe");
  else summary.push("! portable_bild/runtime/node.exe missing — build-installer.ps1 downloads it; a ZIP made from this stage will not start");
  if (exists(path.join(portable, "poppler", "bin", "pdftoppm.exe"))) summary.push("✓ portable_bild/poppler (pdftoppm)");
  else summary.push("– portable_bild/poppler missing (scanned-PDF OCR unavailable)");
}
for (const line of summary) console.log(`[stage]   ${line}`);

// ---------------------------------------------------------------------------
// 2. Fresh stage directory
// ---------------------------------------------------------------------------
fs.rmSync(stageDir, { recursive: true, force: true });
fs.mkdirSync(stageDir, { recursive: true });

function copyTree(from, to, filter) {
  fs.cpSync(from, to, {
    recursive: true,
    dereference: true,
    force: true,
    errorOnExist: false,
    filter: (src) => (filter ? filter(src) : true),
  });
}

// .next without the build cache and the dev-only symlink folder.
const nextSrc = path.join(projectRoot, ".next");
copyTree(nextSrc, path.join(stageDir, ".next"), (src) => {
  const rel = path.relative(nextSrc, src);
  if (!rel) return true;
  const top = rel.split(path.sep)[0];
  return top !== "cache" && top !== "node_modules" && top !== "trace" && top !== "diagnostics";
});
console.log("[stage] copied .next");

// Production node_modules for the target platform.
const keepFile = path.join(stageDir, "..", `node_modules.${platform}-${arch}.txt`);
const prune = childProcess.spawnSync(
  process.execPath,
  [path.join(__dirname, "prune-node-modules.cjs"), projectRoot, keepFile, "--platform", platform, "--arch", arch, ...(keepGpu ? ["--gpu"] : [])],
  { stdio: "inherit" },
);
if (prune.status !== 0) fail("prune-node-modules.cjs failed");
const keep = fs
  .readFileSync(keepFile, "utf8")
  .split(/\r?\n/)
  .filter(Boolean);
const nmSrc = path.join(projectRoot, "node_modules");
const nmDst = path.join(stageDir, "node_modules");
let copied = 0;
for (const pkg of keep) {
  const from = path.join(nmSrc, pkg);
  if (!exists(from)) continue;
  const to = path.join(nmDst, pkg);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  // Nested node_modules of a package are copied separately when they are in
  // the keep list, so exclude them here to avoid copying pruned sub-trees.
  copyTree(from, to, (src) => {
    const rel = path.relative(from, src);
    return !(rel && rel.split(path.sep).includes("node_modules"));
  });
  copied += 1;
}
console.log(`[stage] copied ${copied} production packages`);

// Models (whatever exists), minus temp files.
const modelsSrc = path.join(projectRoot, "models");
if (exists(modelsSrc)) {
  copyTree(modelsSrc, path.join(stageDir, "models"), (src) => !path.basename(src).startsWith(".tmp-"));
}
for (const rel of ["models/llm", "models/embeddings", "models/ocr/tessdata"]) fs.mkdirSync(path.join(stageDir, rel), { recursive: true });
console.log("[stage] copied models");

// Base schema applied by src/db/migrate.ts on first start (read from
// <cwd>/drizzle at runtime — it is NOT bundled into .next).
copyTree(path.join(projectRoot, "drizzle"), path.join(stageDir, "drizzle"));

// Launcher folder (includes runtime/ and poppler/ when present).
copyTree(portable, path.join(stageDir, "portable_bild"));

// Root files.
fs.copyFileSync(path.join(projectRoot, "package.json"), path.join(stageDir, "package.json"));
fs.copyFileSync(path.join(portable, ".env.template"), path.join(stageDir, ".env.template"));
const readme = path.join(__dirname, "README.md");
if (exists(readme)) fs.copyFileSync(readme, path.join(stageDir, "README-Setup.md"));
fs.mkdirSync(path.join(stageDir, "storage"), { recursive: true });
fs.writeFileSync(
  path.join(stageDir, "storage", "README.txt"),
  "Database (PGlite) and uploaded files live in this folder.\r\nBack it up while the application is closed. Never delete it while upgrading.\r\n",
);
fs.writeFileSync(path.join(stageDir, "VERSION.txt"), `${version}\n`);

// ---------------------------------------------------------------------------
// 3. Materialise hashed externals as real folders, then verify.
// ---------------------------------------------------------------------------
const repairScript = path.join(stageDir, "portable_bild", "repair-pglite-external.cjs");
for (const extra of [["--copy"], ["--check"]]) {
  const r = childProcess.spawnSync(process.execPath, [repairScript, stageDir, ...extra], { stdio: "inherit" });
  if (r.status !== 0) fail(`external alias repair (${extra[0]}) failed on the staged bundle`);
}

// No secrets, no symlinks.
if (exists(path.join(stageDir, ".env"))) fail("a .env file ended up in the stage — refusing to package secrets");
let symlinks = 0;
(function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isSymbolicLink()) symlinks += 1;
    else if (entry.isDirectory()) scan(p);
  }
})(stageDir);
if (symlinks > 0) fail(`${symlinks} symlink(s) remain in the stage; installers cannot ship symlinks`);

const total = dirSize(stageDir);
const modelBytes = dirSize(path.join(stageDir, "models"));
console.log(`[stage] done: ${fmtGB(total)} total (models ${fmtGB(modelBytes)}, rest ${fmtGB(total - modelBytes)})`);
fs.writeFileSync(
  path.join(stageDir, "..", "stage-info.json"),
  JSON.stringify({ version, platform, arch, totalBytes: total, modelBytes, stagedAt: new Date().toISOString() }, null, 2),
);
