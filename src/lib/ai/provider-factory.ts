import { config } from "@/lib/config";
import { installNetworkKillSwitch } from "@/lib/ai/network-guard";
import { getLocalLlmProvider } from "@/lib/ai/local-llm-provider";
import { getLocalEmbeddingProvider } from "@/lib/ai/local-embedding-provider";
import { CloudLlmProvider, CloudEmbeddingProvider } from "@/lib/ai/cloud-llm-provider";
import type { EmbeddingProvider, LlmProvider } from "@/lib/ai/types";

// Install the network kill-switch as soon as this module is first loaded on
// the server. This runs before any provider is ever used.
installNetworkKillSwitch();

/**
 * AIProviderFactory
 * ---------------------------------------------------------------------------
 *   AI_MODE=offline | local  -->  LocalLlmProvider only  -->  llama.cpp  -->  local GGUF
 *   AI_MODE=cloud            -->  CloudLlmProvider (still requires CLOUD_AI_ENABLED=true)
 *
 * No other path exists. There is intentionally no automatic fallback from
 * local to cloud: if the local provider is unavailable, callers receive a
 * LOCAL_LLM_UNAVAILABLE error and must surface it to the user as-is.
 */
export function getLlmProvider(): LlmProvider {
  if (config.aiMode === "cloud") {
    if (!config.cloudAiEnabled) {
      throw new Error("AI_MODE=cloud but CLOUD_AI_ENABLED=false. Refusing to use cloud provider.");
    }
    return new CloudLlmProvider();
  }
  return getLocalLlmProvider();
}

export function getEmbeddingProvider(): EmbeddingProvider {
  if (config.aiMode === "cloud") {
    if (!config.cloudAiEnabled) {
      throw new Error("AI_MODE=cloud but CLOUD_AI_ENABLED=false. Refusing to use cloud provider.");
    }
    return new CloudEmbeddingProvider();
  }
  return getLocalEmbeddingProvider();
}

export function currentAiMode() {
  return config.aiMode;
}
