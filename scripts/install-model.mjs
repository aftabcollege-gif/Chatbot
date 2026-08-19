#!/usr/bin/env node
/**
 * Offline-AI Model Installer
 * ---------------------------------------------------------------------------
 * Downloads the local GGUF models (LLM + embeddings) and Tesseract OCR
 * language data that the app needs to run FULLY OFFLINE.
 *
 * Run this ONCE on a machine that has internet access. Afterwards the app
 * (AI_MODE=offline|local) never makes another network request.
 *
 * Usage:
 *   node scripts/install-model.mjs            # install everything
 *   node scripts/install-model.mjs --llm      # chat model only (Qwen2.5-1.5B Q4_K_M)
 *   node scripts/install-model.mjs --embedding# embedding model only (bge-m3 Q8_0)
 *   node scripts/install-model.mjs --ocr      # OCR language data only (fas + eng)
 *   node scripts/install-model.mjs --dry-run  # show what would be downloaded
 *
 * Defaults (env-overridable):
 *   LLM_URL      https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf
 *   EMBED_URL    https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF/resolve/main/bge-m3-q8_0.gguf
 */

import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import https from "node:https";
import zlib from "node:zlib";

const ROOT = path.resolve(new URL("..", import.meta.url).pathname);

const TARGETS = [
  {
    flag: "--llm",
    url: process.env.LLM_URL ?? "https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf",
    dest: path.join(ROOT, "models/llm/model.gguf"),
    label: "LLM (Qwen2.5-1.5B-Instruct Q4_K_M)",
  },
  {
    flag: "--embedding",
    url: process.env.EMBED_URL ?? "https://huggingface.co/ggml-org/bge-m3-Q8_0-GGUF/resolve/main/bge-m3-q8_0.gguf",
    dest: path.join(ROOT, "models/embeddings/model.gguf"),
    label: "Embedding (bge-m3 Q8_0, 1024-dim)",
  },
];

const OCR_TARGETS = [
  {
    lang: "fas",
    url: "https://github.com/tesseract-ocr/tessdata_fast/raw/main/fas.traineddata",
    dest: path.join(ROOT, "models/ocr/tessdata/fas.traineddata.gz"),
    label: "OCR Persian (fas)",
  },
  {
    lang: "eng",
    url: "https://github.com/tesseract-ocr/tessdata_fast/raw/main/eng.traineddata",
    dest: path.join(ROOT, "models/ocr/tessdata/eng.traineddata.gz"),
    label: "OCR English (eng)",
  },
];

const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");

function pick(targets) {
  // If any specific flag is given, only install those; otherwise all.
  const wanted = targets.filter((t) => args.has(t.flag));
  return wanted.length > 0 ? wanted : targets;
}

function humanSize(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/** Download a URL following up to 5 redirects, writing to destPath. */
function download(url, destPath, label) {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    const attempt = (currentUrl) => {
      https
        .get(currentUrl, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            if (redirects++ > 5) return reject(new Error("Too many redirects"));
            return attempt(new URL(res.headers.location, currentUrl).toString());
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} for ${currentUrl}`));
          }
          const total = Number(res.headers["content-length"] ?? 0);
          let received = 0;
          let lastPct = -1;
          const out = fs.createWriteStream(destPath);
          res.on("data", (chunk) => {
            received += chunk.length;
            if (total > 0) {
              const pct = Math.floor((received / total) * 100);
              if (pct !== lastPct && pct % 10 === 0) {
                lastPct = pct;
                process.stdout.write(`\r  ${label}: ${pct}% (${humanSize(received)}/${humanSize(total)})   `);
              }
            }
          });
          res.pipe(out);
          out.on("finish", () => {
            process.stdout.write(`\r  ${label}: 100% (${humanSize(received)})             \n`);
            resolve();
          });
          out.on("error", reject);
          res.on("error", reject);
        })
        .on("error", reject);
    };
    attempt(url);
  });
}

async function main() {
  console.log("📦 Offline-AI Model Installer\n");

  if (dryRun) {
    console.log("Dry run — nothing will be downloaded:\n");
    for (const t of TARGETS) console.log(`  ${t.flag}  -> ${t.url}`);
    for (const t of OCR_TARGETS) console.log(`  --ocr  -> ${t.url} (${t.dest})`);
    return;
  }

  for (const t of pick(TARGETS)) {
    await fsp.mkdir(path.dirname(t.dest), { recursive: true });
    if (fs.existsSync(t.dest) && fs.statSync(t.dest).size > 1024 * 1024) {
      console.log(`✓ Already installed: ${t.label} (${humanSize(fs.statSync(t.dest).size)})`);
      continue;
    }
    console.log(`⬇ Downloading ${t.label} …`);
    await download(t.url, t.dest, t.label);
  }

  if (args.has("--ocr") || ![...args].some((a) => a.startsWith("--") && a !== "--dry-run")) {
    for (const t of OCR_TARGETS) {
      await fsp.mkdir(path.dirname(t.dest), { recursive: true });
      if (fs.existsSync(t.dest) && fs.statSync(t.dest).size > 1024 * 1024) {
        console.log(`✓ Already installed: ${t.label}`);
        continue;
      }
      console.log(`⬇ Downloading ${t.label} (compressed) …`);
      const raw = path.join(ROOT, `models/ocr/tessdata/.tmp-${t.lang}.traineddata`);
      await download(t.url, raw, t.label);
      await new Promise((resolve, reject) => {
        const input = fs.createReadStream(raw);
        const output = fs.createWriteStream(t.dest);
        input.pipe(zlib.createGzip()).pipe(output);
        output.on("finish", resolve);
        output.on("error", reject);
      });
      await fsp.unlink(raw).catch(() => {});
    }
  }

  console.log("\n🎉 Done. Verify file sizes:");
  for (const t of TARGETS) {
    if (fs.existsSync(t.dest)) {
      const size = fs.statSync(t.dest).size;
      console.log(`  ✓ ${t.label}: ${humanSize(size)} -> ${path.relative(ROOT, t.dest)}`);
    }
  }
  for (const t of OCR_TARGETS) {
    if (fs.existsSync(t.dest)) {
      const size = fs.statSync(t.dest).size;
      console.log(`  ✓ ${t.label}: ${humanSize(size)} -> ${path.relative(ROOT, t.dest)}`);
    }
  }

  console.log(`
💡 Next steps:
  1. Copy .env.example to .env and set DATABASE_URL + JWT_SECRET.
  2. Start the app: npm run build && npm start   (or npm run dev)
  3. The app is now fully offline-capable: AI_MODE=offline is the default and
     the network kill-switch blocks every outbound AI request.`);
}

main().catch((err) => {
  console.error("\n❌ Install failed:", err.message);
  process.exit(1);
});
