/**
 * AI Provider Interface — Offline-First Architecture
 *
 * CRITICAL REQUIREMENT (Directive §15):
 * Production registry MUST ONLY contain LocalLLMProvider implementations.
 * Adding a Cloud provider requires code change + explicit human approval.
 * Silent fallback to cloud is STRICTLY PROHIBITED.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LLMProvider {
  readonly name: string;
  readonly isLocal: boolean;
  chat(messages: ChatMessage[], options?: ChatOptions): Promise<LLMResponse>;
  isAvailable(): Promise<boolean>;
}

export interface ChatOptions {
  temperature?: number;
  maxTokens?: number;
  topP?: number;
  stream?: boolean;
}

export interface LLMResponse {
  content: string;
  tokenCount?: number;
  latencyMs?: number;
  modelName?: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly isLocal: boolean;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
  embedBatch(texts: string[]): Promise<number[][]>;
  isAvailable(): Promise<boolean>;
}

export interface AIProviderStatus {
  llm: {
    available: boolean;
    name: string;
    isLocal: boolean;
    latencyMs?: number;
    error?: string;
  };
  embedding: {
    available: boolean;
    name: string;
    isLocal: boolean;
    dimensions: number;
    latencyMs?: number;
    error?: string;
  };
}
