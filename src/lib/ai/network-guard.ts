import { isOfflineOnly } from "@/lib/config";

/**
 * Network Kill-Switch
 * ---------------------------------------------------------------------------
 * When AI_MODE is "offline" or "local", this module patches the global
 * `fetch` implementation so that any attempt to reach a non-local host is
 * rejected before a socket is ever opened. This is the last line of defense
 * against silent Cloud AI fallback: even if a future code change imports an
 * SDK that tries to call out to the internet, the request will be blocked.
 *
 * Loopback (localhost/127.0.0.1/::1) and same-process internal calls remain
 * allowed because some local runtimes (e.g. an on-prem llama.cpp server)
 * may be exposed over localhost HTTP instead of an in-process binding.
 */

const ALLOWED_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isAllowedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (ALLOWED_HOSTS.has(parsed.hostname)) return true;
    // Allow private LAN ranges only if explicitly using the "local" mode,
    // which still forbids public internet AI providers by host allow-list
    // below (never relaxed).
    return false;
  } catch {
    // Relative URLs / non-HTTP(s) schemes (e.g. server-internal requests)
    return true;
  }
}

const BLOCKED_AI_HOST_FRAGMENTS = [
  "openai.com",
  "anthropic.com",
  "googleapis.com",
  "generativelanguage",
  "groq.com",
  "openrouter.ai",
  "huggingface.co",
  "together.ai",
  "together.xyz",
  "replicate.com",
  "azure.com",
  "cohere.ai",
  "cohere.com",
  "mistral.ai",
  "perplexity.ai",
];

export class NetworkKillSwitchError extends Error {
  code = "NETWORK_KILL_SWITCH_BLOCKED" as const;
  constructor(url: string) {
    super(
      `Outbound network request to "${url}" was blocked by the offline network kill-switch. ` +
        `AI_MODE is set to an offline mode; no external AI or telemetry request is permitted.`,
    );
    this.name = "NetworkKillSwitchError";
  }
}

let patched = false;
let originalFetch: typeof fetch | null = null;

export function installNetworkKillSwitch(): void {
  if (patched) return;
  if (!isOfflineOnly()) return; // Only enforced in offline/local modes.
  if (typeof globalThis.fetch !== "function") return;

  originalFetch = globalThis.fetch.bind(globalThis);
  const guardedFetch: typeof fetch = async (input, init) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

    const lower = url.toLowerCase();
    const targetsKnownAiCloud = BLOCKED_AI_HOST_FRAGMENTS.some((fragment) => lower.includes(fragment));

    if (targetsKnownAiCloud || !isAllowedUrl(url)) {
      throw new NetworkKillSwitchError(url);
    }

    return originalFetch!(input, init);
  };

  globalThis.fetch = guardedFetch;
  patched = true;
}

export function isNetworkKillSwitchActive(): boolean {
  return patched;
}
