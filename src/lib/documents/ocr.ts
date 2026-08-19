import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { Worker } from "tesseract.js";
import type { ExtractedPage } from "@/lib/documents/extract";

const execFileAsync = promisify(execFile);

const TESSDATA_PATH = path.resolve(process.cwd(), "models/ocr/tessdata");
const OCR_LANGS = "fas+eng"; // Persian + English, fully local trained data

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const exists = await fs
        .access(path.join(TESSDATA_PATH, "eng.traineddata.gz"))
        .then(() => true)
        .catch(() => false);
      if (!exists) {
        throw new Error(
          `OCR language data not found at ${TESSDATA_PATH}. Run scripts/install-model.mjs to install offline OCR data.`,
        );
      }
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker(["fas", "eng"], undefined, {
        langPath: TESSDATA_PATH,
        cachePath: TESSDATA_PATH,
        gzip: true,
      });
      return worker;
    })();
  }
  return workerPromise;
}

export async function ocrImageBuffer(buffer: Buffer): Promise<string> {
  const worker = await getWorker();
  const { data } = await worker.recognize(buffer);
  return data.text;
}

/**
 * Renders each PDF page to a PNG using the local `pdftoppm` (poppler-utils)
 * binary, then runs local Tesseract OCR on every page image. Fully offline.
 */
export async function ocrScannedPdf(buffer: Buffer): Promise<ExtractedPage[]> {
  const workDir = await fs.mkdtemp(path.join(os.tmpdir(), "ocr-pdf-"));
  const pdfPath = path.join(workDir, "input.pdf");
  await fs.writeFile(pdfPath, buffer);

  try {
    const outPrefix = path.join(workDir, "page");
    await execFileAsync("pdftoppm", ["-png", "-r", "200", pdfPath, outPrefix], {
      maxBuffer: 50 * 1024 * 1024,
    });

    const files = (await fs.readdir(workDir)).filter((f) => f.endsWith(".png")).sort();
    const pages: ExtractedPage[] = [];
    for (const file of files) {
      const match = file.match(/-(\d+)\.png$/) ?? file.match(/(\d+)\.png$/);
      const pageNum = match ? Number(match[1]) : pages.length + 1;
      const imgBuffer = await fs.readFile(path.join(workDir, file));
      const text = await ocrImageBuffer(imgBuffer);
      pages.push({ page: pageNum, text });
    }
    return pages.length > 0 ? pages : [{ page: 1, text: "" }];
  } finally {
    await fs.rm(workDir, { recursive: true, force: true });
  }
}

export async function terminateOcrWorker(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise;
    await worker.terminate();
    workerPromise = null;
  }
}

export async function ocrHealthCheck(): Promise<{ available: boolean; detail?: string }> {
  try {
    const exists = await fs
      .access(path.join(TESSDATA_PATH, "eng.traineddata.gz"))
      .then(() => true)
      .catch(() => false);
    const fasExists = await fs
      .access(path.join(TESSDATA_PATH, "fas.traineddata.gz"))
      .then(() => true)
      .catch(() => false);
    if (!exists || !fasExists) {
      return { available: false, detail: "Persian/English trained data not installed locally." };
    }
    await execFileAsync("pdftoppm", ["-v"]).catch(() => {
      throw new Error("poppler-utils (pdftoppm) is not installed.");
    });
    return { available: true };
  } catch (err) {
    return { available: false, detail: err instanceof Error ? err.message : String(err) };
  }
}
