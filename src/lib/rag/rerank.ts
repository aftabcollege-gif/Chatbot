/**
 * Second-stage reranking of the fused candidate pool.
 *
 * Stage 1 (always on, ~0 ms): lexical evidence — fraction of distinct query
 * terms present in the chunk, with a bonus when the query terms occur close
 * together (phrase-like matches). This corrects the main weakness of RRF on a
 * huge corpus: a chunk that is semantically "near" but does not actually
 * contain the asked-about entity/number gets pushed below one that does.
 *
 * Stage 2 (optional, LOCAL_RERANKER_MODEL_PATH): a GGUF cross-encoder such as
 * bge-reranker-v2-m3 through node-llama-cpp's ranking context. It is applied
 * to at most `RERANK_CANDIDATES` chunks so its cost is bounded regardless of
 * corpus size. If the model is missing or fails, stage 1 ordering is kept.
 */
import fs from "node:fs";
import path from "node:path";
import { normalizePersian, tokenizePersian, extractKeywordTerms } from "@/lib/text/persian";
import type { RetrievedChunk } from "@/lib/rag/search";

const RERANK_CANDIDATES = 24;

type LlamaModule = typeof import("node-llama-cpp");
type LlamaInstance = Awaited<ReturnType<LlamaModule["getLlama"]>>;
type LlamaModel = Awaited<ReturnType<LlamaInstance["loadModel"]>>;
type LlamaRankingContext = Awaited<ReturnType<LlamaModel["createRankingContext"]>>;

const globalForReranker = globalThis as typeof globalThis & {
  __localReranker?: { context: LlamaRankingContext | null; error: string | null; loading: Promise<LlamaRankingContext | null> | null };
};
const rerankerState = (globalForReranker.__localReranker ??= { context: null, error: null, loading: null });

function rerankerModelPath(): string | null {
  const configured = process.env.LOCAL_RERANKER_MODEL_PATH;
  const candidate = path.resolve(process.cwd(), configured ?? "./models/reranker/model.gguf");
  return fs.existsSync(candidate) ? candidate : null;
}

async function getRankingContext(): Promise<LlamaRankingContext | null> {
  if (rerankerState.context) return rerankerState.context;
  if (rerankerState.error) return null;
  if (rerankerState.loading) return rerankerState.loading;
  const modelPath = rerankerModelPath();
  if (!modelPath) {
    rerankerState.error = "no reranker model installed";
    return null;
  }
  rerankerState.loading = (async () => {
    try {
      const mod = (await import("node-llama-cpp")) as LlamaModule;
      const llama = await mod.getLlama();
      const model = await llama.loadModel({ modelPath });
      const context = await model.createRankingContext({ contextSize: 1024 });
      rerankerState.context = context;
      console.log(`[RAG] local reranker loaded: ${modelPath}`);
      return context;
    } catch (error) {
      rerankerState.error = error instanceof Error ? error.message : String(error);
      console.error("[RAG] reranker unavailable — lexical rerank only:", rerankerState.error);
      return null;
    } finally {
      rerankerState.loading = null;
    }
  })();
  return rerankerState.loading;
}

/** Lexical evidence score in [0, 1]. */
export function lexicalEvidence(queryTerms: string[], content: string): number {
  if (queryTerms.length === 0) return 0;
  const tokens = tokenizePersian(normalizePersian(content));
  if (tokens.length === 0) return 0;

  const positions = new Map<string, number[]>();
  tokens.forEach((token, i) => {
    for (const term of queryTerms) {
      if (token === term || (term.length >= 4 && token.startsWith(term))) {
        const list = positions.get(term);
        if (list) list.push(i);
        else positions.set(term, [i]);
      }
    }
  });

  const coverage = positions.size / queryTerms.length;
  if (positions.size < 2) return coverage;

  // Proximity: smallest window containing one occurrence of each matched term.
  const matched = Array.from(positions.values());
  let bestWindow = Number.POSITIVE_INFINITY;
  const anchors = matched[0];
  for (const anchor of anchors) {
    let lo = anchor;
    let hi = anchor;
    for (let k = 1; k < matched.length; k++) {
      let nearest = Number.POSITIVE_INFINITY;
      let nearestPos = anchor;
      for (const p of matched[k]) {
        const d = Math.abs(p - anchor);
        if (d < nearest) {
          nearest = d;
          nearestPos = p;
        }
      }
      lo = Math.min(lo, nearestPos);
      hi = Math.max(hi, nearestPos);
    }
    bestWindow = Math.min(bestWindow, hi - lo + 1);
  }
  const proximity = Number.isFinite(bestWindow) ? Math.min(1, positions.size / bestWindow) : 0;
  return 0.75 * coverage + 0.25 * proximity;
}

export async function rerankChunks(query: string, candidates: RetrievedChunk[], topK: number): Promise<RetrievedChunk[]> {
  if (candidates.length === 0) return [];

  const { terms } = extractKeywordTerms(query, 16);
  const pool = candidates.slice(0, RERANK_CANDIDATES);
  const rest = candidates.slice(RERANK_CANDIDATES);

  // Stage 1 — combine RRF (normalised to the pool max) with lexical evidence.
  const maxFused = Math.max(...pool.map((c) => c.fusedScore)) || 1;
  const stage1 = pool.map((chunk) => {
    const evidence = lexicalEvidence(terms, chunk.content);
    const score = 0.6 * (chunk.fusedScore / maxFused) + 0.4 * evidence;
    return { chunk, evidence, score };
  });
  stage1.sort((a, b) => b.score - a.score);

  // Stage 2 — cross-encoder if installed (pointless for a single candidate).
  const ranking = stage1.length > 1 ? await getRankingContext() : null;
  if (ranking) {
    try {
      const documents = stage1.map((s) => s.chunk.content.slice(0, 1500));
      const ranked = await ranking.rankAndSort(query, documents);
      const byDoc = new Map(documents.map((d, i) => [d, stage1[i]]));
      const final = ranked
        .map((r) => {
          const entry = byDoc.get(r.document as string);
          if (!entry) return null;
          // Blend so a tiny cross-encoder disagreement cannot fully override
          // strong lexical + retrieval agreement.
          const score = 0.7 * r.score + 0.3 * entry.score;
          return { ...entry.chunk, fusedScore: score };
        })
        .filter((x): x is RetrievedChunk => x !== null)
        .sort((a, b) => b.fusedScore - a.fusedScore);
      return [...final, ...rest].slice(0, topK);
    } catch (error) {
      console.error("[RAG] cross-encoder rerank failed — using lexical order:", error);
    }
  }

  return [...stage1.map((s) => ({ ...s.chunk, fusedScore: s.score })), ...rest].slice(0, topK);
}
