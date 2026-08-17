type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

type ProviderResponse = { choices?: Array<{ message?: { content?: string } }> };

function baseUrl() {
  const value = process.env.AI_BASE_URL?.trim();
  if (!value) throw new Error("AI_BASE_URL is required");
  return value.replace(/\/$/, "");
}

function headers() {
  const key = process.env.AI_API_KEY;
  return {
    "Content-Type": "application/json",
    ...(key ? { Authorization: `Bearer ${key}` } : {}),
  };
}

async function providerFetch(path: string, body: unknown) {
  const response = await fetch(`${baseUrl()}${path}`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`AI provider error (${response.status}): ${detail.slice(0, 500)}`);
  }
  return response;
}

export async function aiChat(messages: ChatMessage[]) {
  const response = await providerFetch("/chat/completions", {
    model: process.env.AI_CHAT_MODEL,
    messages,
    temperature: Number(process.env.AI_TEMPERATURE ?? "0.1"),
    stream: false,
  });
  const data = (await response.json()) as ProviderResponse;
  return data.choices?.[0]?.message?.content?.trim() ?? "";
}

export async function createEmbedding(input: string) {
  const response = await providerFetch("/embeddings", {
    model: process.env.AI_EMBED_MODEL,
    input,
  });
  const data = (await response.json()) as { data?: Array<{ embedding?: number[] }> };
  const embedding = data.data?.[0]?.embedding;
  if (!embedding?.length) throw new Error("Embedding provider returned no vector");
  const expected = Number(process.env.EMBEDDING_DIMENSIONS ?? "1536");
  if (embedding.length !== expected) throw new Error(`Embedding dimension mismatch: expected ${expected}, received ${embedding.length}`);
  return embedding;
}

export async function createEmbeddings(inputs: string[]) {
  if (!inputs.length) return [];
  const response = await providerFetch("/embeddings", {
    model: process.env.AI_EMBED_MODEL,
    input: inputs,
  });
  const data = (await response.json()) as { data?: Array<{ index: number; embedding?: number[] }> };
  const items = [...(data.data ?? [])].sort((a, b) => a.index - b.index);
  const expected = Number(process.env.EMBEDDING_DIMENSIONS ?? "1536");
  if (items.length !== inputs.length || items.some((item) => !item.embedding?.length || item.embedding.length !== expected)) {
    throw new Error("Embedding provider returned an invalid batch response");
  }
  return items.map((item) => item.embedding!);
}

/** Check if AI provider is configured */
export function isAIConfigured(): boolean {
  return !!(process.env.AI_BASE_URL?.trim());
}
