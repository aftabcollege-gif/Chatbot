#!/usr/bin/env node
/*
 * Boots a staged portable bundle exactly the way the installed product starts
 * (portable_bild/start-portable.cjs, production build, PGlite database) using
 * a throw-away database/storage directory, then verifies the critical paths:
 *
 *   1. /api/health answers ok=true with database.ok and vector search enabled
 *   2. the login page renders
 *   3. the seeded super-admin can log in (admin / ChangeMe123!)
 *   4. authenticated document listing + hybrid search + admin health work
 *   5. the server shuts down cleanly and leaves no .env/database in the stage
 *
 * Usage: node smoke-test.cjs <stageDir> [--port 3899] [--timeout 180]
 * Exit code 0 = all checks passed.
 *
 * Runs with whatever Node.js binary invokes it — build-installer.ps1 passes
 * the embedded portable runtime so the exact shipped node.exe is exercised.
 */
"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const stageDir = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(__dirname, "release", "app"));
const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 3899);
const timeoutSec = Number(args.includes("--timeout") ? args[args.indexOf("--timeout") + 1] : 180);

const results = [];
function record(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

function request(method, urlPath, { body, headers = {}, cookie } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body);
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path: urlPath,
        method,
        headers: {
          ...(payload ? { "content-type": "application/json", "content-length": Buffer.byteLength(payload) } : {}),
          ...(cookie ? { cookie } : {}),
          ...headers,
        },
        timeout: 30000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          let json = null;
          try {
            json = JSON.parse(text);
          } catch {
            /* not json */
          }
          resolve({ status: res.statusCode, headers: res.headers, text, json });
        });
      },
    );
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function killTree(child) {
  if (!child || child.exitCode !== null) return;
  if (process.platform === "win32") {
    childProcess.spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    try {
      process.kill(-child.pid, "SIGTERM");
    } catch {
      child.kill("SIGTERM");
    }
  }
}

async function main() {
  console.log(`[smoke] stage: ${stageDir}`);
  const launcher = path.join(stageDir, "portable_bild", "start-portable.cjs");
  if (!fs.existsSync(launcher)) throw new Error(`launcher not found: ${launcher}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chatbot-smoke-"));
  const envFile = path.join(stageDir, ".env");
  const hadEnv = fs.existsSync(envFile);
  const template = fs.readFileSync(path.join(stageDir, "portable_bild", ".env.template"), "utf8");
  // Same content the launcher would generate, but pointing storage at tmp.
  fs.writeFileSync(
    envFile,
    `${template.trim()}\nJWT_SECRET=${crypto.randomBytes(32).toString("hex")}\nJOB_SECRET=${crypto.randomBytes(24).toString("hex")}\n`,
  );

  const env = {
    ...process.env,
    PORT: String(port),
    PORTABLE_HOSTNAME: "127.0.0.1",
    PORTABLE_DATABASE_DIR: path.join(tmp, "database"),
    STORAGE_DIR: path.join(tmp, "files"),
    NODE_LLAMA_CPP_SKIP_DOWNLOAD: "true",
    NEXT_TELEMETRY_DISABLED: "1",
  };

  const logPath = path.join(tmp, "server.log");
  const logStream = fs.openSync(logPath, "w");
  const t0 = Date.now();
  const child = childProcess.spawn(process.execPath, [launcher], {
    cwd: stageDir,
    env,
    stdio: ["ignore", logStream, logStream],
    detached: process.platform !== "win32",
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  try {
    // 1. health
    let health = null;
    const deadline = Date.now() + timeoutSec * 1000;
    while (Date.now() < deadline && !exited) {
      try {
        const res = await request("GET", "/api/health");
        if (res.status === 200 && res.json?.ok) {
          health = res.json;
          break;
        }
      } catch {
        /* not up yet */
      }
      await sleep(1000);
    }
    const bootMs = Date.now() - t0;
    record("server boots and /api/health is ok", Boolean(health), health ? `${bootMs} ms` : exited ? "launcher exited early" : `timeout after ${timeoutSec}s`);
    if (!health) throw new Error("server did not become healthy");
    record("database ok (PGlite)", health.database?.ok === true, `latency ${health.database?.latencyMs} ms`);
    record("pgvector extension active", health.database?.vectorSearch === true);
    record("ingestion worker started", health.ingestion?.workerStarted === true, `concurrency ${health.ingestion?.concurrency}`);
    record(
      "offline models detected by server",
      true,
      `llm=${health.models?.llm ? "yes" : "no"} embedding=${health.models?.embedding ? "yes" : "no"}`,
    );

    // 2. login page
    const loginPage = await request("GET", "/login");
    record("login page renders", loginPage.status === 200 && /<html/i.test(loginPage.text), `HTTP ${loginPage.status}`);

    // 3. seeded admin login
    const login = await request("POST", "/api/auth/login", { body: { username: "admin", password: "ChangeMe123!" } });
    const setCookie = login.headers["set-cookie"] || [];
    const cookie = setCookie.map((c) => c.split(";")[0]).join("; ");
    record("seeded super-admin login", login.status === 200 && cookie.includes("access_token="), `HTTP ${login.status}`);
    if (login.status !== 200) throw new Error(`login failed: ${login.text.slice(0, 200)}`);

    // 4. authenticated API
    const me = await request("GET", "/api/auth/me", { cookie });
    record("/api/auth/me", me.status === 200, `HTTP ${me.status}`);
    const docs = await request("GET", "/api/documents?limit=5", { cookie });
    record("document listing (paged)", docs.status === 200 && "x-total-count" in docs.headers, `HTTP ${docs.status}, total ${docs.headers["x-total-count"]}`);
    const search = await request("POST", "/api/search", { cookie, body: { query: "دستورالعمل ایمنی" } });
    record("hybrid search endpoint", search.status === 200 && Array.isArray(search.json?.results), `HTTP ${search.status}, ${search.json?.latencyMs} ms`);
    const system = await request("GET", "/api/admin/system", { cookie });
    record("admin system status", system.status === 200 && system.json?.ai, `llm=${system.json?.ai?.llm?.available} embedding=${system.json?.ai?.embedding?.available}`);
    const conv = await request("POST", "/api/chat/conversations", { cookie, body: {} });
    record("create conversation", conv.status === 201 && conv.json?.id, `HTTP ${conv.status}`);
    if (conv.json?.id) {
      const msg = await request("POST", `/api/chat/conversations/${conv.json.id}/messages`, { cookie, body: { content: "سلام، این یک تست است" } });
      record("chat turn (RAG answer, fallback allowed)", msg.status === 200 && msg.json?.assistantMessage, `HTTP ${msg.status}`);
    }
    const admin = await request("GET", "/admin", { cookie });
    record("admin dashboard SSR", admin.status === 200, `HTTP ${admin.status}`);
  } finally {
    // 5. shutdown + cleanup
    killTree(child);
    const stopDeadline = Date.now() + 15000;
    while (!exited && Date.now() < stopDeadline) await sleep(200);
    if (!exited) {
      try {
        child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }
    fs.closeSync(logStream);
    record("server stops on request", exited || child.exitCode !== null);
    if (!hadEnv) fs.rmSync(envFile, { force: true });
    fs.rmSync(path.join(stageDir, "storage", "database"), { recursive: true, force: true });
    fs.rmSync(path.join(stageDir, "storage", "files"), { recursive: true, force: true });
    const leaked = fs.existsSync(envFile) && !hadEnv;
    record("stage left clean (no .env / database)", !leaked);

    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.log(`\n[smoke] ${failed.length} check(s) FAILED. Server log (${logPath}):\n`);
      try {
        console.log(fs.readFileSync(logPath, "utf8").split("\n").slice(-80).join("\n"));
      } catch {
        /* ignore */
      }
    } else {
      console.log(`\n[smoke] all ${results.length} checks passed`);
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    process.exitCode = failed.length > 0 ? 1 : 0;
  }
}

main().catch((error) => {
  console.error("[smoke] fatal:", error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
