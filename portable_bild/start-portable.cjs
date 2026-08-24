#!/usr/bin/env node
/* Offline portable entry point. Run this instead of calling `next start`
 * directly so hashed Turbopack PGlite externals are repaired before Next
 * evaluates its instrumentation hook. */
"use strict";

const childProcess = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const projectRoot = path.resolve(__dirname, "..");
const repair = path.join(__dirname, "repair-pglite-external.cjs");
const repairResult = childProcess.spawnSync(process.execPath, [repair, projectRoot], {
  cwd: projectRoot,
  stdio: "inherit",
});
if (repairResult.status !== 0) process.exit(repairResult.status || 1);

const port = process.env.PORT || "3800";
const standaloneServer = path.join(projectRoot, ".next", "standalone", "server.js");
const command = fs.existsSync(standaloneServer)
  ? [process.execPath, [standaloneServer]]
  : [process.execPath, [path.join(projectRoot, "node_modules", "next", "dist", "bin", "next"), "start", "-p", port]];

const server = childProcess.spawn(command[0], command[1], {
  cwd: projectRoot,
  env: { ...process.env, PORT: port },
  stdio: "inherit",
});
server.on("error", (error) => {
  console.error("[portable] Unable to start Next.js:", error.message);
  process.exit(1);
});
server.on("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
