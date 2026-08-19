import path from "node:path";

export type AiMode = "offline" | "local" | "cloud";

function readBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return value.toLowerCase() === "true" || value === "1";
}

function readNumber(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readAiMode(value: string | undefined): AiMode {
  if (value === "local" || value === "cloud" || value === "offline") return value;
  // Default is always offline. Any unrecognized value fails safe to offline.
  return "offline";
}

const projectRoot = process.cwd();

export const config = {
  aiMode: readAiMode(process.env.AI_MODE),

  localLlm: {
    enabled: readBool(process.env.LOCAL_LLM_ENABLED, true),
    runtime: process.env.LOCAL_LLM_RUNTIME ?? "llama.cpp",
    modelPath: path.resolve(projectRoot, process.env.LOCAL_LLM_MODEL_PATH ?? "./models/llm/model.gguf"),
    contextSize: readNumber(process.env.LOCAL_LLM_CONTEXT_SIZE, 4096),
    threads: readNumber(process.env.LOCAL_LLM_THREADS, 4),
    gpuLayers: readNumber(process.env.LOCAL_LLM_GPU_LAYERS, 0),
    temperature: readNumber(process.env.LOCAL_LLM_TEMPERATURE, 0.1),
    maxTokens: readNumber(process.env.LOCAL_LLM_MAX_TOKENS, 512),
  },

  localEmbedding: {
    enabled: readBool(process.env.LOCAL_EMBEDDING_ENABLED, true),
    modelPath: path.resolve(
      projectRoot,
      process.env.LOCAL_EMBEDDING_MODEL_PATH ?? "./models/embeddings/model.gguf",
    ),
    dimensions: readNumber(process.env.LOCAL_EMBEDDING_DIMENSIONS, 1024),
  },

  rag: {
    topK: readNumber(process.env.RAG_TOP_K, 8),
    minScore: readNumber(process.env.RAG_MIN_SCORE, 0.15),
    chunkSize: readNumber(process.env.RAG_CHUNK_SIZE, 800),
    chunkOverlap: readNumber(process.env.RAG_CHUNK_OVERLAP, 120),
  },

  storageDir: path.resolve(projectRoot, process.env.STORAGE_DIR ?? "./storage"),

  auth: {
    jwtSecret: process.env.JWT_SECRET ?? "insecure-default-change-me",
    sessionTtlHours: readNumber(process.env.SESSION_TTL_HOURS, 12),
  },

  rateLimit: {
    windowSeconds: readNumber(process.env.RATE_LIMIT_WINDOW_SECONDS, 60),
    maxRequests: readNumber(process.env.RATE_LIMIT_MAX_REQUESTS, 60),
  },

  cloudAiEnabled: readBool(process.env.CLOUD_AI_ENABLED, false),
} as const;

/** True when the system must never make an outbound AI network request. */
export function isOfflineOnly(): boolean {
  return config.aiMode !== "cloud";
}

export const LOCAL_LLM_UNAVAILABLE = "LOCAL_LLM_UNAVAILABLE";
export const LOCAL_LLM_UNAVAILABLE_MESSAGE_FA =
  "مدل زبانی محلی در دسترس نیست. برای حفظ حالت آفلاین، هیچ درخواست خارجی ارسال نشد.";

export const NO_CONTEXT_FOUND_MESSAGE_FA =
  "اطلاعات کافی در منابع سازمانی برای پاسخ به این پرسش پیدا نشد.";
