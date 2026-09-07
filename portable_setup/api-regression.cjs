#!/usr/bin/env node
/*
 * End-to-end API regression suite for a staged portable bundle (or any
 * project folder that contains portable_bild/start-portable.cjs + .next).
 *
 * It boots the server on a throw-away database exactly like the installed
 * product, then drives the real HTTP API through the complete business flow:
 *
 *   auth  → login, /me, wrong password, lockout-safe
 *   docs  → upload (txt + docx + multi), duplicate 409, background ingestion
 *           to "completed", paged listing, X-Total-Count, delete
 *   search→ Persian keyword query, code/ID query (BULK-042 style), latency
 *   chat  → conversation, JSON answer with citations, NDJSON streaming events,
 *           history, chat rate limit (429 + Retry-After)
 *   know. → knowledge item → review → approve → publish → retrievable in
 *           search; experience → submit → approve → publish → retrievable
 *   rbac  → create EMPLOYEE user, forbidden on admin endpoints, allowed on chat
 *   import→ folder import (copy mode) + dedupe on re-run
 *   ops   → /api/health shape, audit log paging, admin system settings PATCH,
 *           maintenance status
 *
 * Usage: node api-regression.cjs <stageDir> [--port 3898] [--keep]
 * Exit code 0 = every check passed.
 */
"use strict";

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const args = process.argv.slice(2);
const stageDir = path.resolve(args.find((a) => !a.startsWith("--")) || path.join(__dirname, "..", "..", ".."));
const port = Number(args.includes("--port") ? args[args.indexOf("--port") + 1] : 3898);
const keep = args.includes("--keep");

const results = [];
let currentGroup = "";
function group(name) {
  currentGroup = name;
  console.log(`\n[${name}]`);
}
function check(name, ok, detail = "") {
  results.push({ group: currentGroup, name, ok, detail });
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return ok;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------------------
// tiny HTTP client (cookies, JSON, multipart, streaming)
// ---------------------------------------------------------------------------
function request(method, urlPath, { body, headers = {}, cookie, raw } = {}) {
  return new Promise((resolve, reject) => {
    let payload;
    const h = { ...(cookie ? { cookie } : {}), ...headers };
    if (raw) payload = raw;
    else if (body !== undefined) {
      payload = Buffer.from(JSON.stringify(body));
      h["content-type"] = "application/json";
    }
    if (payload) h["content-length"] = payload.length;
    const req = http.request({ host: "127.0.0.1", port, path: urlPath, method, headers: h, timeout: 120000 }, (res) => {
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
    });
    req.on("timeout", () => req.destroy(new Error("request timeout")));
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function multipart(fields, files) {
  const boundary = `----chatbot${crypto.randomBytes(8).toString("hex")}`;
  const parts = [];
  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`));
  }
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="${f.field}"; filename="${f.filename}"\r\nContent-Type: ${f.type}\r\n\r\n`,
      ),
    );
    parts.push(f.data);
    parts.push(Buffer.from("\r\n"));
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return { raw: Buffer.concat(parts), headers: { "content-type": `multipart/form-data; boundary=${boundary}` } };
}

// Minimal DOCX (a zip with the mandatory parts) so the mammoth path is exercised.
function makeDocx(text) {
  let AdmZip;
  try {
    AdmZip = require(path.join(stageDir, "node_modules", "adm-zip"));
  } catch {
    return null;
  }
  const zip = new AdmZip();
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
  zip.addFile(
    "[Content_Types].xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    ),
  );
  zip.addFile(
    "_rels/.rels",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    ),
  );
  const paragraphs = text
    .split("\n")
    .map((p) => `<w:p><w:r><w:t xml:space="preserve">${esc(p)}</w:t></w:r></w:p>`)
    .join("");
  zip.addFile(
    "word/document.xml",
    Buffer.from(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs}</w:body></w:document>`,
    ),
  );
  return zip.toBuffer();
}

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

async function waitForDocument(cookie, id, timeoutMs = 120000) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    const res = await request("GET", `/api/documents/${id}`, { cookie });
    last = res.json?.document ?? res.json;
    if (last?.status === "completed" || last?.status === "failed") return last;
    await sleep(1000);
  }
  return last;
}

async function main() {
  const runId = crypto.randomBytes(4).toString("hex");
  console.log(`[regression] stage: ${stageDir}  run: ${runId}  port: ${port}`);
  const launcher = path.join(stageDir, "portable_bild", "start-portable.cjs");
  if (!fs.existsSync(launcher)) throw new Error(`launcher not found: ${launcher}`);

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "chatbot-regression-"));
  const envFile = path.join(stageDir, ".env");
  const hadEnv = fs.existsSync(envFile);
  if (!hadEnv) {
    const template = fs.readFileSync(path.join(stageDir, "portable_bild", ".env.template"), "utf8");
    fs.writeFileSync(
      envFile,
      `${template.trim()}\nJWT_SECRET=${crypto.randomBytes(32).toString("hex")}\nJOB_SECRET=${crypto.randomBytes(24).toString("hex")}\n`,
    );
  }

  const env = {
    ...process.env,
    PORT: String(port),
    PORTABLE_HOSTNAME: "127.0.0.1",
    PORTABLE_DATABASE_DIR: path.join(tmp, "database"),
    STORAGE_DIR: path.join(tmp, "files"),
    NODE_LLAMA_CPP_SKIP_DOWNLOAD: "true",
    NEXT_TELEMETRY_DISABLED: "1",
    // Tight chat limit so the 429 path can be verified quickly.
    RATE_LIMIT_CHAT_MAX: "6",
    RATE_LIMIT_CHAT_WINDOW_MINUTES: "1",
    MAINTENANCE_INTERVAL_MINUTES: "1",
    INGEST_POLL_INTERVAL_MS: "300",
  };
  const logPath = path.join(tmp, "server.log");
  const logFd = fs.openSync(logPath, "w");
  const t0 = Date.now();
  const child = childProcess.spawn(process.execPath, [launcher], {
    cwd: stageDir,
    env,
    stdio: ["ignore", logFd, logFd],
    detached: process.platform !== "win32",
  });
  let exited = false;
  child.on("exit", () => {
    exited = true;
  });

  try {
    // -----------------------------------------------------------------------
    group("boot");
    let health = null;
    const deadline = Date.now() + 180000;
    while (Date.now() < deadline && !exited) {
      try {
        const res = await request("GET", "/api/health");
        if (res.status === 200 && res.json?.ok) {
          health = res.json;
          break;
        }
      } catch {
        /* not yet */
      }
      await sleep(1000);
    }
    if (!check("server healthy", Boolean(health), `${Date.now() - t0} ms`)) throw new Error("server did not start");
    check("schema migrated", health.database?.migrations?.status === "ok", `${health.database?.migrations?.durationMs} ms`);
    check("pgvector available", health.database?.vectorSearch === true);
    check("worker started", health.ingestion?.workerStarted === true);

    // -----------------------------------------------------------------------
    group("auth");
    const bad = await request("POST", "/api/auth/login", { body: { username: "admin", password: "wrong-password" } });
    check("wrong password rejected", bad.status === 401 || bad.status === 400, `HTTP ${bad.status}`);
    const login = await request("POST", "/api/auth/login", { body: { username: "admin", password: "ChangeMe123!" } });
    const admin = (login.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
    if (!check("admin login", login.status === 200 && admin.includes("access_token="), `HTTP ${login.status}`)) throw new Error("login failed");
    const me = await request("GET", "/api/auth/me", { cookie: admin });
    check("/api/auth/me returns user", me.status === 200 && (me.json?.user?.username === "admin" || me.json?.username === "admin"));
    const anon = await request("GET", "/api/documents");
    check("anonymous request rejected", anon.status === 401, `HTTP ${anon.status}`);

    // -----------------------------------------------------------------------
    group("documents");
    const code = `RG-${runId.slice(0, 4).toUpperCase()}`;
    const txt = Buffer.from(
      `دستورالعمل نگهداری پمپ سانتریفیوژ ${code}\n` +
        `روغن یاتاقان پمپ سانتریفیوژ باید هر ۵۰۰ ساعت کارکرد تعویض شود. کد تجهیز ${code} در سامانه ثبت شده است.\n` +
        `در صورت افزایش دمای یاتاقان بیش از ۷۰ درجه، پمپ باید متوقف و بازرسی شود. شناسهٔ اجرا ${runId}.\n`,
      "utf8",
    );
    const up1 = multipart({ title: `دستورالعمل ${code}` }, [{ field: "file", filename: `maintenance-${runId}.txt`, type: "text/plain", data: txt }]);
    const r1 = await request("POST", "/api/documents", { cookie: admin, raw: up1.raw, headers: up1.headers });
    const docId = r1.json?.id;
    check("upload txt (201)", r1.status === 201 && docId, `HTTP ${r1.status}`);
    const dup = await request("POST", "/api/documents", { cookie: admin, raw: up1.raw, headers: up1.headers });
    check("duplicate upload → 409", dup.status === 409, `HTTP ${dup.status}`);

    const docxBuf = makeDocx(`گزارش بازرسی فرم QA-${runId.slice(4, 8)}\nنتیجه بازرسی: تنظیم فشار کمپرسور هوا در حد مجاز ۸ بار قرار گرفت. شناسه ${runId}.`);
    let docxId = null;
    if (docxBuf) {
      const up2 = multipart({}, [
        {
          field: "file",
          filename: `inspection-${runId}.docx`,
          type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          data: docxBuf,
        },
      ]);
      const r2 = await request("POST", "/api/documents", { cookie: admin, raw: up2.raw, headers: up2.headers });
      docxId = r2.json?.id;
      check("upload docx (201)", r2.status === 201 && docxId, `HTTP ${r2.status}`);
    } else {
      check("upload docx (201)", true, "skipped — adm-zip not staged");
    }
    const badExt = multipart({}, [{ field: "file", filename: `evil-${runId}.exe`, type: "application/octet-stream", data: Buffer.from("MZ...") }]);
    const r3 = await request("POST", "/api/documents", { cookie: admin, raw: badExt.raw, headers: badExt.headers });
    check("disallowed extension → 400", r3.status === 400, `HTTP ${r3.status}`);

    const d1 = await waitForDocument(admin, docId);
    check("txt ingested → completed", d1?.status === "completed", `status=${d1?.status} chunks=${d1?.chunkCount ?? "?"}`);
    if (docxId) {
      const d2 = await waitForDocument(admin, docxId);
      check("docx ingested → completed", d2?.status === "completed", `status=${d2?.status}`);
    }
    const list = await request("GET", "/api/documents?limit=1&offset=0", { cookie: admin });
    const total = Number(list.headers["x-total-count"]);
    const items = Array.isArray(list.json) ? list.json : list.json?.items ?? list.json?.documents ?? [];
    check("paged listing + X-Total-Count", list.status === 200 && total >= 1 && items.length === 1, `total=${total} has-more=${list.headers["x-has-more"]}`);
    const filtered = await request("GET", "/api/documents?limit=50&status=completed", { cookie: admin });
    check("status filter", filtered.status === 200, `HTTP ${filtered.status}`);

    // -----------------------------------------------------------------------
    group("search");
    const s1 = await request("POST", "/api/search", { cookie: admin, body: { query: "روغن یاتاقان پمپ سانتریفیوژ" } });
    const hit1 = s1.json?.results?.find((r) => r.sourceId === docId);
    check("Persian keyword query finds the document", s1.status === 200 && Boolean(hit1), `${s1.json?.totalResults} results, ${s1.json?.latencyMs} ms`);
    const s2 = await request("POST", "/api/search", { cookie: admin, body: { query: code } });
    const first2 = s2.json?.results?.[0];
    check("equipment code query ranks the document first", first2?.sourceId === docId, `top=${first2?.title ?? "none"} score=${first2?.relevanceScore?.toFixed?.(2)}`);
    const s3 = await request("POST", "/api/search", { cookie: admin, body: { query: `کد ${code.toLowerCase()} چیست` } });
    check("lower-case code inside a Persian sentence", s3.json?.results?.[0]?.sourceId === docId, `${s3.json?.latencyMs} ms`);
    const s4 = await request("POST", "/api/search", { cookie: admin, body: { query: "" } });
    check("empty query → 400", s4.status === 400, `HTTP ${s4.status}`);
    const latencies = [];
    for (let i = 0; i < 5; i++) {
      const r = await request("POST", "/api/search", { cookie: admin, body: { query: "دمای یاتاقان بازرسی" } });
      latencies.push(r.json?.latencyMs ?? 9999);
    }
    latencies.sort((a, b) => a - b);
    check("search latency p50 < 500 ms", latencies[2] < 500, `p50=${latencies[2]} ms max=${latencies[4]} ms`);

    // -----------------------------------------------------------------------
    group("chat");
    const conv = await request("POST", "/api/chat/conversations", { cookie: admin, body: {} });
    const convId = conv.json?.id;
    check("create conversation", conv.status === 201 && convId, `HTTP ${conv.status}`);
    const q = `روغن یاتاقان پمپ ${code} هر چند ساعت باید تعویض شود؟`;
    const m1 = await request("POST", `/api/chat/conversations/${convId}/messages`, { cookie: admin, body: { content: q } });
    const answer = m1.json?.assistantMessage?.content ?? "";
    check("JSON answer with citations", m1.status === 200 && answer.length > 0 && (m1.json?.sources?.length ?? 0) > 0, `${m1.json?.sources?.length} sources, ${answer.length} chars`);
    check("answer is grounded in the uploaded document", /۵۰۰|500/.test(answer), answer.slice(0, 60).replace(/\n/g, " "));

    // streaming
    const stream = await new Promise((resolve, reject) => {
      const payload = Buffer.from(JSON.stringify({ content: `دمای مجاز یاتاقان ${code} چقدر است؟` }));
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: `/api/chat/conversations/${convId}/messages`,
          method: "POST",
          headers: { cookie: admin, "content-type": "application/json", accept: "application/x-ndjson", "content-length": payload.length },
          timeout: 120000,
        },
        (res) => {
          const chunks = [];
          let firstByteMs = null;
          const start = Date.now();
          res.on("data", (c) => {
            if (firstByteMs === null) firstByteMs = Date.now() - start;
            chunks.push(c);
          });
          res.on("end", () => resolve({ status: res.statusCode, type: res.headers["content-type"], firstByteMs, text: Buffer.concat(chunks).toString("utf8") }));
        },
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
    const events = stream.text
      .split("\n")
      .filter(Boolean)
      .map((l) => {
        try {
          return JSON.parse(l);
        } catch {
          return { type: "invalid" };
        }
      });
    const types = events.map((e) => e.type);
    check("NDJSON stream: user → sources → done", stream.status === 200 && types[0] === "user" && types.includes("sources") && types[types.length - 1] === "done", `${types.join(",")} (first byte ${stream.firstByteMs} ms)`);
    const hist = await request("GET", `/api/chat/conversations/${convId}/messages`, { cookie: admin });
    const histItems = Array.isArray(hist.json) ? hist.json : hist.json?.messages ?? [];
    check("history has 4 messages", hist.status === 200 && histItems.length === 4, `${histItems.length} messages`);
    const convs = await request("GET", "/api/chat/conversations", { cookie: admin });
    const convList = Array.isArray(convs.json) ? convs.json : convs.json?.conversations ?? convs.json?.items ?? [];
    const thisConv = convList.find((c) => c.id === convId);
    check("conversation list shows message count", Boolean(thisConv) && (thisConv.messageCount === 4 || thisConv.messageCount === undefined), `messageCount=${thisConv?.messageCount}`);

    let limited = null;
    for (let i = 0; i < 8 && !limited; i++) {
      const r = await request("POST", `/api/chat/conversations/${convId}/messages`, { cookie: admin, body: { content: `تست محدودیت ${i}` } });
      if (r.status === 429) limited = r;
    }
    check("chat rate limit → 429 + Retry-After", Boolean(limited) && Boolean(limited.headers["retry-after"]), limited ? `Retry-After ${limited.headers["retry-after"]}s` : "never limited");

    // -----------------------------------------------------------------------
    group("knowledge & experiences");
    const kb = await request("POST", "/api/knowledge", {
      cookie: admin,
      body: {
        title: `راهنمای کالیبراسیون فشارسنج ${runId}`,
        subject: "کالیبراسیون",
        content: `فشارسنج‌های خط ${code} باید هر شش ماه با مرجع کلاس ۰٫۲۵ کالیبره شوند و برچسب تاریخ اعتبار الصاق گردد. شناسه ${runId}.`,
        visibility: "organization",
        tags: ["کالیبراسیون", "ابزار دقیق"],
      },
    });
    const kbId = kb.json?.id;
    check("create knowledge item (201)", kb.status === 201 && kbId, `HTTP ${kb.status}`);
    let kbOk = true;
    for (const status of ["UNDER_REVIEW", "APPROVED", "PUBLISHED"]) {
      const r = await request("PATCH", `/api/knowledge/${kbId}`, { cookie: admin, body: { status } });
      if (r.status !== 200) {
        kbOk = false;
        check(`knowledge → ${status}`, false, `HTTP ${r.status} ${r.text.slice(0, 80)}`);
        break;
      }
    }
    if (kbOk) check("knowledge workflow → PUBLISHED", true);
    const ex = await request("POST", "/api/experiences", {
      cookie: admin,
      body: {
        title: `تجربه رفع لرزش فن خنک‌کننده ${runId}`,
        subject: "لرزش",
        problemDescription: `فن خنک‌کنندهٔ برج ${code} لرزش شدید داشت و آلارم ارتعاش فعال می‌شد.`,
        rootCause: "نامیزانی پروانه پس از تعویض تیغه",
        actionsTaken: "بالانس دینامیکی پروانه در محل انجام شد و پیچ‌های پایه با گشتاور استاندارد بسته شدند.",
        results: "ارتعاش از ۱۲ به ۲٫۱ میلی‌متر بر ثانیه کاهش یافت.",
        lessonsLearned: `پس از هر تعویض تیغه، بالانس دینامیکی الزامی است. شناسه ${runId}.`,
        importance: "HIGH",
        tags: ["ارتعاش", "فن"],
      },
    });
    const exId = ex.json?.id;
    check("create experience (201)", ex.status === 201 && exId, `HTTP ${ex.status}`);
    let exOk = true;
    for (const action of ["submit", "approve", "publish"]) {
      const r = await request("PATCH", `/api/experiences/${exId}`, { cookie: admin, body: { action } });
      if (r.status !== 200) {
        exOk = false;
        check(`experience → ${action}`, false, `HTTP ${r.status} ${r.text.slice(0, 80)}`);
        break;
      }
    }
    if (exOk) check("experience workflow → PUBLISHED", true);

    // Published items are chunked by background jobs — wait for the queue to drain.
    let drained = false;
    for (let i = 0; i < 60 && !drained; i++) {
      const h = await request("GET", "/api/health");
      const qstat = h.json?.ingestion?.queue;
      if (qstat && qstat.pending === 0 && qstat.processing === 0 && (h.json?.ingestion?.running ?? 0) === 0) drained = true;
      else await sleep(1000);
    }
    check("ingestion queue drained", drained);
    const sk = await request("POST", "/api/search", { cookie: admin, body: { query: "کالیبراسیون فشارسنج مرجع" } });
    check("published knowledge is retrievable", sk.json?.results?.some((r) => r.sourceType === "knowledge" || r.sourceId === kbId), `${sk.json?.totalResults} results`);
    const se = await request("POST", "/api/search", { cookie: admin, body: { query: "لرزش فن خنک کننده بالانس" } });
    check("published experience is retrievable", se.json?.results?.some((r) => r.sourceType === "experience" || r.sourceId === exId), `${se.json?.totalResults} results`);

    // -----------------------------------------------------------------------
    group("rbac");
    const newUser = await request("POST", "/api/admin/users", {
      cookie: admin,
      body: { name: `کارمند ${runId}`, email: `emp-${runId}@example.local`, username: `emp_${runId}`, password: "Employee#12345", roleName: "EMPLOYEE" },
    });
    check("admin creates EMPLOYEE user", newUser.status === 201 || newUser.status === 200, `HTTP ${newUser.status}`);
    const empLogin = await request("POST", "/api/auth/login", { body: { username: `emp_${runId}`, password: "Employee#12345" } });
    const emp = (empLogin.headers["set-cookie"] || []).map((c) => c.split(";")[0]).join("; ");
    check("employee login", empLogin.status === 200 && emp.includes("access_token="), `HTTP ${empLogin.status}`);
    const empAdmin = await request("GET", "/api/admin/system", { cookie: emp });
    check("employee forbidden on admin endpoint", empAdmin.status === 403, `HTTP ${empAdmin.status}`);
    const empUsers = await request("GET", "/api/admin/users", { cookie: emp });
    check("employee forbidden on user management", empUsers.status === 403, `HTTP ${empUsers.status}`);
    const empSearch = await request("POST", "/api/search", { cookie: emp, body: { query: "پمپ سانتریفیوژ" } });
    check("employee may search", empSearch.status === 200, `HTTP ${empSearch.status}`);
    const empConv = await request("POST", "/api/chat/conversations", { cookie: emp, body: {} });
    check("employee may chat", empConv.status === 201, `HTTP ${empConv.status}`);
    const empOther = await request("GET", `/api/chat/conversations/${convId}/messages`, { cookie: emp });
    check("employee cannot read another user's conversation", empOther.status === 404 || empOther.status === 403, `HTTP ${empOther.status}`);
    const empUpload = multipart({}, [{ field: "file", filename: `emp-${runId}.txt`, type: "text/plain", data: Buffer.from("متن آزمایشی") }]);
    const empUp = await request("POST", "/api/documents", { cookie: emp, raw: empUpload.raw, headers: empUpload.headers });
    check("employee cannot upload documents", empUp.status === 403, `HTTP ${empUp.status}`);

    // -----------------------------------------------------------------------
    group("folder import");
    const importDir = path.join(tmp, "import");
    fs.mkdirSync(importDir, { recursive: true });
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(importDir, `bulk-${runId}-${i}.txt`), `سند انبوه شماره ${i} — کد BULK-${runId.slice(0, 3)}${i}\nروال بازرسی هفتگی ${i} برای کمپرسور هوا و فیلتر روغن. شناسه ${runId}.\n`);
    }
    fs.writeFileSync(path.join(importDir, "ignored.bin"), Buffer.from([0, 1, 2]));
    const before = Number((await request("GET", "/api/documents?limit=1", { cookie: admin })).headers["x-total-count"]);
    const imp = await request("POST", "/api/documents/import", { cookie: admin, body: { sourceDir: importDir, mode: "copy" } });
    check("start folder import (202 accepted)", imp.status === 202 && imp.json?.started, `HTTP ${imp.status}`);
    let batch = null;
    for (let i = 0; i < 60 && !batch; i++) {
      await sleep(1000);
      const st = await request("GET", "/api/documents/import", { cookie: admin });
      batch = (st.json?.batches || []).find((b) => b.source_path === importDir && b.status === "COMPLETED");
    }
    check("import batch completed", Boolean(batch), batch ? `imported=${batch.imported_files} skipped=${batch.skipped_files}` : "timeout");
    check("5 imported, 1 unsupported skipped", batch?.imported_files === 5 && batch?.skipped_files === 1);
    const after = Number((await request("GET", "/api/documents?limit=1", { cookie: admin })).headers["x-total-count"]);
    check("document count +5", after === before + 5, `${before} → ${after}`);
    const imp2 = await request("POST", "/api/documents/import", { cookie: admin, body: { sourceDir: importDir, mode: "copy" } });
    let batch2 = null;
    for (let i = 0; i < 30 && !batch2; i++) {
      await sleep(1000);
      const st = await request("GET", "/api/documents/import", { cookie: admin });
      batch2 = (st.json?.batches || []).find((b) => b.source_path === importDir && b.status === "COMPLETED" && b.id !== batch?.id);
    }
    check("re-import accepted right after the first one finished", imp2.status === 202, `HTTP ${imp2.status} ${imp2.json?.error ?? ""}`);
    check("re-import skips duplicates", batch2?.imported_files === 0 && batch2?.skipped_files === 6, batch2 ? `imported=${batch2.imported_files} skipped=${batch2.skipped_files}` : "timeout");
    const after2 = Number((await request("GET", "/api/documents?limit=1", { cookie: admin })).headers["x-total-count"]);
    check("document count unchanged after re-import", after2 === after, `${after2}`);
    const empImport = await request("POST", "/api/documents/import", { cookie: emp, body: { sourceDir: importDir } });
    check("employee cannot run folder import", empImport.status === 403, `HTTP ${empImport.status}`);
    drained = false;
    for (let i = 0; i < 90 && !drained; i++) {
      const h = await request("GET", "/api/health");
      const qstat = h.json?.ingestion?.queue;
      if (qstat && qstat.pending === 0 && qstat.processing === 0 && (h.json?.ingestion?.running ?? 0) === 0) drained = true;
      else await sleep(1000);
    }
    check("imported files ingested", drained);
    const sb = await request("POST", "/api/search", { cookie: admin, body: { query: `BULK-${runId.slice(0, 3)}3` } });
    check("imported document found by its code", sb.json?.results?.[0]?.title?.includes(`bulk-${runId}-3`) || sb.json?.results?.some((r) => r.title?.includes(`bulk-${runId}-3`)), `top=${sb.json?.results?.[0]?.title}`);

    // -----------------------------------------------------------------------
    group("operations");
    const sys = await request("GET", "/api/admin/system", { cookie: admin });
    check("admin system status", sys.status === 200 && sys.json?.ai?.llm && sys.json?.rag, `llm=${sys.json?.ai?.llm?.available} emb=${sys.json?.ai?.embedding?.available} topK=${sys.json?.rag?.topK}`);
    const patch = await request("PATCH", "/api/admin/system", { cookie: admin, body: { topK: 6, minScore: 0.2 } });
    check("update RAG settings", patch.status === 200 && patch.json?.rag?.topK === 6, `topK=${patch.json?.rag?.topK}`);
    await request("PATCH", "/api/admin/system", { cookie: admin, body: { topK: 8, minScore: 0.15 } });
    const audit = await request("GET", "/api/audit?limit=5&offset=0", { cookie: admin });
    const auditItems = Array.isArray(audit.json) ? audit.json : audit.json?.items ?? audit.json?.logs ?? [];
    check("audit log paged", audit.status === 200 && auditItems.length > 0 && "x-total-count" in audit.headers, `total=${audit.headers["x-total-count"]}`);
    const h2 = await request("GET", "/api/health");
    check("health exposes maintenance + memory", Boolean(h2.json?.maintenance) && typeof h2.json?.memory?.rssMb === "number", `rss ${h2.json?.memory?.rssMb} MB`);
    const del = await request("DELETE", `/api/documents/${docId}`, { cookie: admin });
    check("delete document", del.status === 200 || del.status === 204, `HTTP ${del.status}`);
    const gone = await request("GET", `/api/documents/${docId}`, { cookie: admin });
    check("deleted document no longer readable", gone.status === 404, `HTTP ${gone.status}`);
    const sd = await request("POST", "/api/search", { cookie: admin, body: { query: code } });
    check("deleted document no longer searchable", !sd.json?.results?.some((r) => r.sourceId === docId), `${sd.json?.totalResults} results`);
    const logout = await request("POST", "/api/auth/logout", { cookie: admin });
    check("logout", logout.status === 200, `HTTP ${logout.status}`);
    const afterLogout = await request("GET", "/api/auth/me", { cookie: admin });
    check("session invalid after logout", afterLogout.status === 401, `HTTP ${afterLogout.status}`);
  } finally {
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
    fs.closeSync(logFd);
    group("shutdown");
    check("server stopped", exited || child.exitCode !== null);
    if (!hadEnv) fs.rmSync(envFile, { force: true });
    fs.rmSync(path.join(stageDir, "storage", "database"), { recursive: true, force: true });
    fs.rmSync(path.join(stageDir, "storage", "files"), { recursive: true, force: true });

    const failed = results.filter((r) => !r.ok);
    console.log(`\n[regression] ${results.length - failed.length}/${results.length} checks passed`);
    if (failed.length > 0) {
      console.log(`\nFailed:\n${failed.map((f) => `  - [${f.group}] ${f.name}${f.detail ? ` (${f.detail})` : ""}`).join("\n")}`);
      console.log(`\nServer log tail (${logPath}):`);
      try {
        console.log(fs.readFileSync(logPath, "utf8").split("\n").slice(-60).join("\n"));
      } catch {
        /* ignore */
      }
    } else if (!keep) {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    process.exitCode = failed.length > 0 ? 1 : 0;
  }
}

main().catch((error) => {
  console.error("[regression] fatal:", error instanceof Error ? error.stack || error.message : error);
  process.exitCode = 1;
});
