#!/usr/bin/env node
/*
 * Next/Turbopack can turn an external PGlite import into a build-specific
 * package name such as @electric-sql/pglite-7966c14983af6418.  That name is
 * not published to npm: it is an alias that must point at the real PGlite
 * package included in the portable distribution.
 *
 * This script recreates those aliases before Next loads instrumentation.ts.
 * It intentionally works without npm, internet access, symlinks, or admin
 * privileges, which makes it suitable for a copied Windows portable folder.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(process.argv[2] || path.join(__dirname, ".."));
const nodeModules = path.join(projectRoot, "node_modules");
const pglitePackage = path.join(nodeModules, "@electric-sql", "pglite");
const chunksDirectory = path.join(projectRoot, ".next", "server", "chunks");
const aliasPattern = /@electric-sql\/pglite-[0-9a-f]{8,}/g;

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
  for (const filename of collectFiles(chunksDirectory)) {
    const source = fs.readFileSync(filename, "utf8");
    for (const match of source.matchAll(aliasPattern)) aliases.add(match[0]);
  }
  return [...aliases];
}

function packageCanBeResolved(packageName) {
  try {
    require.resolve(packageName, { paths: [projectRoot] });
    return true;
  } catch {
    return false;
  }
}

function copyAlias(alias) {
  const target = path.join(nodeModules, ...alias.split("/"));
  if (packageCanBeResolved(alias)) return false;

  const temporaryTarget = `${target}.repairing-${process.pid}`;
  fs.rmSync(temporaryTarget, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(pglitePackage, temporaryTarget, { recursive: true });
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(temporaryTarget, target);

  if (!packageCanBeResolved(alias)) {
    throw new Error(`Created ${target}, but Node.js still cannot resolve ${alias}.`);
  }
  return true;
}

function main() {
  const aliases = aliasesInBuild();
  if (aliases.length === 0) {
    console.log("[portable] No hashed PGlite external was found; no repair is needed.");
    return;
  }

  if (!fs.existsSync(pglitePackage)) {
    console.error("\n[portable] PGlite repair cannot continue.");
    console.error(`The build needs: ${aliases.join(", ")}`);
    console.error(`But the real offline dependency is missing: ${pglitePackage}`);
    console.error("Restore node_modules/@electric-sql/pglite from the portable package, then run this launcher again. Do not run npm install while offline.\n");
    process.exitCode = 1;
    return;
  }

  let repaired = 0;
  for (const alias of aliases) {
    if (copyAlias(alias)) repaired += 1;
  }
  console.log(repaired
    ? `[portable] Repaired ${repaired} PGlite external module alias(es).`
    : "[portable] PGlite external module aliases are ready.");
}

main();
