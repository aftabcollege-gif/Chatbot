import { config } from "@/lib/config";
import { chatMutex, getChatContext } from "@/lib/ai/llama-runtime";
import { LocalLlmUnavailableError } from "@/lib/ai/types";
import type { AiHealth, ChatMessageInput, GenerateOptions, GenerateResult, LlmProvider } from "@/lib/ai/types";

export class LocalLlmProvider implements LlmProvider {
  readonly kind = "local" as const;

  async generate(messages: ChatMessageInput[], options: GenerateOptions = {}): Promise<GenerateResult> {
    const start = Date.now();
    return chatMutex.run(async () => {
      const { mod, context } = await getChatContext();
      const sequence = context.getSequence();
      try {
        const systemPrompt = messages.find((m) => m.role === "system")?.content;
        const nonSystem = messages.filter((m) => m.role !== "system");

        // Fold prior conversation turns into the final user turn as plain
        // text. This keeps the integration simple and deterministic instead
        // of depending on an internal chat-history object shape, while still
        // giving the model full context for grounded RAG answers.
        const priorTurns = nonSystem.slice(0, -1);
        const lastUserMessage = nonSystem[nonSystem.length - 1]?.content ?? "";

        let combinedPrompt = "";
        if (priorTurns.length > 0) {
          combinedPrompt += priorTurns
            .map((m) => `${m.role === "user" ? "کاربر" : "دستیار"}: ${m.content}`)
            .join("\n\n");
          combinedPrompt += "\n\n";
        }
        combinedPrompt += lastUserMessage;

        const session = new mod.LlamaChatSession({
          contextSequence: sequence,
          systemPrompt,
        });

        let text = "";
        const result = await session.prompt(combinedPrompt, {
          temperature: options.temperature ?? config.localLlm.temperature,
          maxTokens: options.maxTokens ?? config.localLlm.maxTokens,
          signal: options.signal,
          onTextChunk: (chunk: string) => {
            text += chunk;
            options.onToken?.(chunk);
          },
        });

        const finalText = result ?? text;
        return {
          text: finalText,
          promptTokens: 0,
          completionTokens: finalText.length,
          latencyMs: Date.now() - start,
        };
      } finally {
        sequence.dispose();
      }
    });
  }

  async health(): Promise<AiHealth> {
    try {
      await getChatContext();
      return {
        available: true,
        status: "ok",
        modelName: "Qwen2.5-1.5B-Instruct (GGUF, Q4_K_M)",
        modelPath: config.localLlm.modelPath,
      };
    } catch (err) {
      const detail =
        err instanceof LocalLlmUnavailableError ? err.message : err instanceof Error ? err.message : String(err);
      return { available: false, status: "unavailable", detail, modelPath: config.localLlm.modelPath };
    }
  }
}

let singleton: LocalLlmProvider | null = null;
export function getLocalLlmProvider(): LocalLlmProvider {
  if (!singleton) singleton = new LocalLlmProvider();
  return singleton;
}
