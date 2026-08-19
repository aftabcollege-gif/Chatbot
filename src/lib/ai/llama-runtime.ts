import fs from "node:fs";
import crypto from "node:crypto";
import { config } from "@/lib/config";
import { LocalLlmUnavailableError } from "@/lib/ai/types";

// node-llama-cpp is ESM-only; it must be dynamically imported from this
// CommonJS/TS-compiled server codebase.
type LlamaModule = typeof import("node-llama-cpp");
type LlamaInstance = Awaited<ReturnType<LlamaModule["getLlama"]>>;
type LlamaModel = Awaited<ReturnType<LlamaInstance["loadModel"]>>;
type LlamaContext = Awaited<ReturnType<LlamaModel["createContext"]>>;
type LlamaEmbeddingContext = Awaited<ReturnType<LlamaModel["createEmbeddingContext"]>>;

interface RuntimeState {
  llama: LlamaInstance | null;
  chatModel: LlamaModel | null;
  chatContext: LlamaContext | null;
  embeddingModel: LlamaModel | null;
  embeddingContext: LlamaEmbeddingContext | null;
  chatInitError: string | null;
  embeddingInitError: string | null;
  chatModule: LlamaModule | null;
}

const globalForLlama = globalThis as typeof globalThis & { __localAiRuntime?: RuntimeState };

const state: RuntimeState =
  globalForLlama.__localAiRuntime ??
  {
    llama: null,
    chatModel: null,
    chatContext: null,
    embeddingModel: null,
    embeddingContext: null,
    chatInitError: null,
    embeddingInitError: null,
    chatModule: null,
  };
globalForLlama.__localAiRuntime = state;

// Simple async mutex so we never run two CPU-bound inference calls
// concurrently against the same llama.cpp context (native library is not
// safe for concurrent use on a single context/sequence).
class Mutex {
  private queue: Promise<void> = Promise.resolve();
  async run<T>(fn: () => Promise<T>): Promise<T> {
    let release!: () => void;
    const ticket = new Promise<void>((resolve) => (release = resolve));
    const previous = this.queue;
    this.queue = ticket;
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export const chatMutex = new Mutex();
export const embeddingMutex = new Mutex();

function assertModelFileExists(modelPath: string, label: string): void {
  if (!fs.existsSync(modelPath)) {
    throw new LocalLlmUnavailableError(
      `${label} model file not found at "${modelPath}". Install the model via scripts/install-model.mjs. ` +
        `Model download is never performed automatically at runtime.`,
    );
  }
}

export async function sha256File(filePath: string): Promise<string> {
  const hash = crypto.createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve());
    stream.on("error", reject);
  });
  return hash.digest("hex");
}

async function getLlamaModule(): Promise<LlamaModule> {
  if (state.chatModule) return state.chatModule;
  // Dynamic import required: node-llama-cpp is ESM-only.
  const mod = (await import("node-llama-cpp")) as LlamaModule;
  state.chatModule = mod;
  return mod;
}

async function getLlamaInstance(): Promise<LlamaInstance> {
  if (state.llama) return state.llama;
  const mod = await getLlamaModule();
  state.llama = await mod.getLlama();
  return state.llama;
}

export async function getChatContext(): Promise<{ mod: LlamaModule; context: LlamaContext }> {
  if (!config.localLlm.enabled) {
    throw new LocalLlmUnavailableError("LOCAL_LLM_ENABLED is set to false in configuration.");
  }
  if (state.chatContext) {
    const mod = await getLlamaModule();
    return { mod, context: state.chatContext };
  }
  if (state.chatInitError) {
    throw new LocalLlmUnavailableError(state.chatInitError);
  }
  try {
    assertModelFileExists(config.localLlm.modelPath, "LLM");
    const mod = await getLlamaModule();
    const llama = await getLlamaInstance();
    const model = await llama.loadModel({ modelPath: config.localLlm.modelPath });
    const context = await model.createContext({
      contextSize: config.localLlm.contextSize,
      threads: config.localLlm.threads,
    });
    state.chatModel = model;
    state.chatContext = context;
    return { mod, context };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.chatInitError = msg;
    throw new LocalLlmUnavailableError(`Failed to load local LLM: ${msg}`);
  }
}

export async function getEmbeddingContext(): Promise<LlamaEmbeddingContext> {
  if (!config.localEmbedding.enabled) {
    throw new LocalLlmUnavailableError("LOCAL_EMBEDDING_ENABLED is set to false in configuration.");
  }
  if (state.embeddingContext) return state.embeddingContext;
  if (state.embeddingInitError) {
    throw new LocalLlmUnavailableError(state.embeddingInitError);
  }
  try {
    assertModelFileExists(config.localEmbedding.modelPath, "Embedding");
    const llama = await getLlamaInstance();
    const model = await llama.loadModel({ modelPath: config.localEmbedding.modelPath });
    const embeddingContext = await model.createEmbeddingContext();
    state.embeddingModel = model;
    state.embeddingContext = embeddingContext;
    return embeddingContext;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.embeddingInitError = msg;
    throw new LocalLlmUnavailableError(`Failed to load local embedding model: ${msg}`);
  }
}

export function resetRuntimeErrorsForRetry(): void {
  state.chatInitError = null;
  state.embeddingInitError = null;
}

export function isChatModelFilePresent(): boolean {
  return fs.existsSync(config.localLlm.modelPath);
}

export function isEmbeddingModelFilePresent(): boolean {
  return fs.existsSync(config.localEmbedding.modelPath);
}
