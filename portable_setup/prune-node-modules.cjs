#!/usr/bin/env node
/*
 * Computes the list of node_modules packages that the production server
 * really needs on Windows x64, using package-lock.json as the source of
 * truth. Output: one relative package path per line (e.g. "next",
 * "@electric-sql/pglite", "next/node_modules/postcss") written to the file
 * given as the second argument.
 *
 * Rules:
 *   - start from the root package's `dependencies` (never devDependencies);
 *   - follow `dependencies`, `optionalDependencies` and `peerDependencies`
 *     of every reached package, respecting nested node_modules resolution;
 *   - drop packages whose `os`/`cpu` constraints exclude win32/x64
 *     (e.g. @next/swc-linux-*, @node-llama-cpp/linux-*, @esbuild/*);
 *   - drop GPU-only llama.cpp binaries (cuda/vulkan) — the portable
 *     configuration is CPU-only (LOCAL_LLM_GPU_LAYERS=0) and those packages
 *     add ~600 MB;
 *   - keep whatever `extraKeep` lists (nothing by default).
 *
 * Usage: node prune-node-modules.cjs <projectRoot> <outFile> [--platform win32] [--arch x64] [--gpu]
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const [projectRootArg, outFileArg, ...rest] = process.argv.slice(2);
if (!projectRootArg || !outFileArg) {
  console.error("usage: prune-node-modules.cjs <projectRoot> <outFile> [--platform win32] [--arch x64] [--gpu]");
  process.exit(2);
}
const projectRoot = path.resolve(projectRootArg);
const outFile = path.resolve(outFileArg);
const platform = rest.includes("--platform") ? rest[rest.indexOf("--platform") + 1] : "win32";
const arch = rest.includes("--arch") ? rest[rest.indexOf("--arch") + 1] : "x64";
const keepGpu = rest.includes("--gpu");

const lock = JSON.parse(fs.readFileSync(path.join(projectRoot, "package-lock.json"), "utf8"));
const packages = lock.packages;
if (!packages || !packages[""]) {
  console.error("package-lock.json v2/v3 with a root entry is required");
  process.exit(1);
}

function allowedHere(entry) {
  const osOk = !entry.os || entry.os.some((o) => o === platform) && !entry.os.some((o) => o === `!${platform}`);
  const cpuOk = !entry.cpu || entry.cpu.some((c) => c === arch) && !entry.cpu.some((c) => c === `!${arch}`);
  return osOk && cpuOk;
}

function isGpuBinary(key) {
  return /@node-llama-cpp\/[a-z0-9-]*-(cuda|cuda-ext|vulkan|metal)$/.test(key);
}

/** Resolve dependency `name` required from lock key `fromKey` (node resolution). */
function resolveDep(fromKey, name) {
  let base = fromKey; // e.g. "node_modules/next"
  for (;;) {
    const candidate = base ? `${base}/node_modules/${name}` : `node_modules/${name}`;
    if (packages[candidate]) return candidate;
    if (!base) return null;
    const idx = base.lastIndexOf("/node_modules/");
    base = idx === -1 ? "" : base.slice(0, idx);
  }
}

const keep = new Set();
const queue = [];
const root = packages[""];
for (const name of Object.keys(root.dependencies || {})) {
  const key = resolveDep("", name);
  if (key) queue.push(key);
  else console.warn(`[prune] root dependency not found in lockfile: ${name}`);
}

while (queue.length > 0) {
  const key = queue.pop();
  if (keep.has(key)) continue;
  const entry = packages[key];
  if (!entry) continue;
  if (!allowedHere(entry)) continue;
  if (!keepGpu && isGpuBinary(key)) continue;
  keep.add(key);
  // Optional peers (e.g. node-llama-cpp → typescript) are dev-time only and
  // must not drag toolchains into the bundle.
  const optionalPeers = new Set(Object.keys(entry.peerDependenciesMeta || {}).filter((n) => entry.peerDependenciesMeta[n]?.optional));
  const deps = {
    ...(entry.dependencies || {}),
    ...(entry.optionalDependencies || {}),
    ...Object.fromEntries(Object.entries(entry.peerDependencies || {}).filter(([n]) => !optionalPeers.has(n))),
  };
  for (const name of Object.keys(deps)) {
    const depKey = resolveDep(key, name);
    if (depKey) queue.push(depKey);
    else if (!(entry.optionalDependencies && entry.optionalDependencies[name])) {
      console.warn(`[prune] ${key} depends on ${name} which is not installed`);
    }
  }
}

// Also keep every package that is physically present but not in the lockfile
// graph *and* was created by the alias repair (hashed names) — none at this
// stage, but harmless to include if present.
const nodeModulesDir = path.join(projectRoot, "node_modules");
for (const entry of fs.readdirSync(nodeModulesDir, { withFileTypes: true })) {
  if (/-[0-9a-f]{16}$/.test(entry.name)) keep.add(`node_modules/${entry.name}`);
}

const relative = [...keep]
  .map((k) => k.replace(/^node_modules\//, ""))
  .filter((k) => fs.existsSync(path.join(nodeModulesDir, k)))
  .sort();

fs.writeFileSync(outFile, relative.join("\n") + "\n");
console.log(`[prune] ${relative.length} packages kept for ${platform}/${arch}${keepGpu ? " (+GPU binaries)" : ""} → ${outFile}`);
