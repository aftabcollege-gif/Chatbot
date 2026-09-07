#!/usr/bin/env node
/* Waits until the local server answers /api/health, then opens the default
 * browser once. Used by Start-Portable.bat; exits quietly on timeout so it can
 * never block or crash the launcher. */
"use strict";

const childProcess = require("node:child_process");
const http = require("node:http");

const url = process.argv[2] || "http://localhost:3800";
const deadline = Date.now() + 90_000;

function openBrowser(target) {
  const platform = process.platform;
  try {
    if (platform === "win32") {
      // `start` is a cmd builtin; the empty "" is the window title argument.
      childProcess.spawn("cmd.exe", ["/c", "start", "", target], { detached: true, stdio: "ignore", windowsHide: true }).unref();
    } else if (platform === "darwin") {
      childProcess.spawn("open", [target], { detached: true, stdio: "ignore" }).unref();
    } else {
      childProcess.spawn("xdg-open", [target], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* best effort */
  }
}

function probe() {
  const req = http.get(`${url.replace(/\/$/, "")}/api/health`, { timeout: 2000 }, (res) => {
    res.resume();
    if (res.statusCode && res.statusCode < 500) {
      openBrowser(url);
      return;
    }
    retry();
  });
  req.on("timeout", () => {
    req.destroy();
    retry();
  });
  req.on("error", retry);
}

function retry() {
  if (Date.now() > deadline) return;
  setTimeout(probe, 1000);
}

probe();
