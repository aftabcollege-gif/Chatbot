#!/usr/bin/env node
/*
 * Next/Turbopack turns every `serverExternalPackages` import into a
 * build-specific package name such as
 *
 *   @electric-sql/pglite-7966c14983af6418
 *   node-llama-cpp-ccb7d8a2cbecea22
 *   tesseract.js-ed25e4e50289e64d
 *
 * Those names are not published to npm: during `next build` they are created
 * as symlinks inside `.next/node_modules/` that point at the real packages.
 * Symlinks do not survive every copy/zip/installer step on Windows, so a
 * copied portable folder can fail at start-up with ERR_MODULE_NOT_FOUND.
 *
 * This script scans the production build for hashed externals and makes each
 * one resolvable again from `<projectRoot>/node_modules/<alias>` — first by
 * creating a directory junction/symlink (no admin rights needed on Windows),
 * falling back to a real copy of the package.  It works without npm, internet
 * access or elevated privileges.
 *
 * Usage:
 *   node repair-pglite-external.cjs [projectRoot] [--copy] [--check]
 *     --copy   always create real copies (used when staging the installer)
 *     --check  only report, exit 1 if something would need repairing
 *
 * (The file keeps its historical name because launchers reference it.)
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith("--")));
const positional = args.filter((a) => !a.startsWith("--"));

const projectRoot = path.resolve(positional[0] || path.join(__dirname, ".."));
const nodeModules = path.join(projectRoot, "node_modules");
const serverDirectory = path.join(projectRoot, ".next", "server");
const forceCopy = flags.has("--copy");
const checkOnly = flags.has("--check");

// `<package>-<16 hex chars>`; scoped packages keep their scope.
const aliasPattern = /(@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*|[a-z0-9][a-z0-9._-]*)-([0-9a-f]{16})(?![0-9a-f])/g;

function realPackageFor(alias) {
  const base = alias.replace(/-[0-9a-f]{16}$/, "");
  const candidate = path.join(nodeModules, ...base.split("/"));
  return fs.existsSync(path.join(candidate, "package.json")) ? candidate : null;
}

function collectFiles(directory, files = []) {
  if (!fs.existsSync(directory)) return files;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectFiles(entryPath, files);
    else if (entry.isFile() && /\.(?:js|cjs|mjs)$/.test(entry.name)) files.push(entryPath);
  }
  return files;
}

function aliasesInBuild() {
  const aliases = new Set();
  for (const filename of collectFiles(serverDirectory)) {
    const source = fs.readFileSync(filename, "utf8");
    for (const match of source.matchAll(aliasPattern)) {
      const alias = match[0];
      if (realPackageFor(alias)) aliases.add(alias);
    }
  }
  return [...aliases].sort();
}

function packageCanBeResolved(packageName) {
  try {
    require.resolve(`${packageName}/package.json`, { paths: [projectRoot] });
    return true;
  } catch {
    // ESM-only packages may not export ./package.json; fall back to the
    // directory check used by Node's resolver itself.
    for (const dir of [path.join(nodeModules, ...packageName.split("/")), path.join(projectRoot, ".next", "node_modules", ...packageName.split("/"))]) {
      try {
        if (fs.statSync(dir).isDirectory() && fs.existsSync(path.join(dir, "package.json"))) return true;
      } catch {
        /* keep looking */
      }
    }
    return false;
  }
}

function linkOrCopy(sourcePackage, target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  if (!forceCopy) {
    try {
      // "junction" is honoured on Windows (no privileges required) and
      // ignored on POSIX, where a normal directory symlink is created.
      fs.symlinkSync(sourcePackage, target, "junction");
      return "linked";
    } catch {
      fs.rmSync(target, { recursive: true, force: true });
    }
  }
  const temporaryTarget = `${target}.repairing-${process.pid}`;
  fs.rmSync(temporaryTarget, { recursive: true, force: true });
  fs.cpSync(sourcePackage, temporaryTarget, { recursive: true, dereference: true });
  fs.renameSync(temporaryTarget, target);
  return "copied";
}

function repairAlias(alias) {
  const target = path.join(nodeModules, ...alias.split("/"));
  if (!forceCopy && packageCanBeResolved(alias)) return null;
  if (forceCopy && fs.existsSync(path.join(target, "package.json")) && !fs.lstatSync(target).isSymbolicLink()) return null;
  const sourcePackage = realPackageFor(alias);
  if (!sourcePackage) throw new Error(`Unknown external alias ${alias}.`);
  const how = linkOrCopy(sourcePackage, target);
  if (!packageCanBeResolved(alias)) {
    throw new Error(`Created ${target}, but Node.js still cannot resolve ${alias}.`);
  }
  return how;
}

function main() {
  if (!fs.existsSync(serverDirectory)) {
    console.error(`[portable] Production build not found: ${serverDirectory}`);
    process.exitCode = 1;
    return;
  }
  const aliases = aliasesInBuild();
  if (aliases.length === 0) {
    console.log("[portable] No hashed external package was found in the build; no repair is needed.");
    return;
  }

  if (checkOnly) {
    const missing = aliases.filter((alias) => !packageCanBeResolved(alias));
    if (missing.length > 0) {
      console.error(`[portable] Unresolvable external aliases: ${missing.join(", ")}`);
      process.exitCode = 1;
    } else {
      console.log(`[portable] All ${aliases.length} external alias(es) resolve: ${aliases.join(", ")}`);
    }
    return;
  }

  let linked = 0;
  let copied = 0;
  for (const alias of aliases) {
    const how = repairAlias(alias);
    if (how === "linked") linked += 1;
    else if (how === "copied") copied += 1;
  }
  if (linked + copied === 0) {
    console.log(`[portable] External module aliases are ready (${aliases.length} checked).`);
  } else {
    console.log(`[portable] Repaired ${linked + copied} external module alias(es) (${linked} linked, ${copied} copied).`);
  }
}

try {
  main();
} catch (error) {
  console.error("\n[portable] External module repair failed:", error instanceof Error ? error.message : error);
  console.error("Restore the node_modules folder from the installer, then run the launcher again. Do not run npm install while offline.\n");
  process.exitCode = 1;
}
