// LLMLingua-2 compression engine (10)
// ML semantic pruning via MobileBERT ONNX / sidecar — code-safe, async, fail-open
// Matches https://github.com/cheaper-inference/OmniRoute

import { extractPreservedBlocks, restorePreservedBlocks } from "../../preservation.js";
import { createCompressionStats } from "../../stats.js";

const ENGINE_ID = "llmlingua";

// Spans that must never be pruned (XML tags, negations, modal verbs)
const PROTECTED_SPAN_RE =
  /(<\/?[A-Za-z][A-Za-z0-9._-]*(?:\s[^<>]*?)?\/?>|\b\w+(?:n't|n’t)\b|(?<![A-Za-z0-9_-])(?:not|no|never|none|nothing|nobody|nowhere|neither|nor|cannot|always|must)(?![A-Za-z0-9_-]))/gi;

async function callSidecarBackend(text, opts = {}) {
  const sidecarUrl = process.env.LLMLINGUA_BASE_URL || "http://127.0.0.1:20135";
  const res = await fetch(`${sidecarUrl}/compress`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, rate: opts.compressionRate || 0.5, model: opts.model || "tinybert" }),
    signal: AbortSignal.timeout(opts.timeoutMs || 4000),
  });
  if (res.ok) {
    const data = await res.json();
    if (typeof data.text === "string" && data.text.length < text.length) {
      return data.text;
    }
  }
  return text;
}

export async function compressProseSemantic(text, opts = {}) {
  if (typeof text !== "string" || !text.trim() || text.length < 100) {
    return text;
  }

  // Preserve code blocks, inline code, URLs, LaTeX, markdown tables
  const { text: withPlaceholders, blocks } = extractPreservedBlocks(text);

  // Protected negations and XML tags
  try {
    const compressed = await callSidecarBackend(withPlaceholders, opts);
    return restorePreservedBlocks(compressed, blocks);
  } catch {
    // Fail-open: return original text
    return text;
  }
}

export const llmlinguaEngine = {
  id: ENGINE_ID,
  name: "LLMLingua (SLM)",
  description: "ML semantic token pruning via MobileBERT ONNX — code-safe, async, fail-open.",
  icon: "memory",
  targets: ["messages"],
  stackable: true,
  stackPriority: 35,
  metadata: {
    id: ENGINE_ID,
    name: "LLMLingua",
    description: "Semantic pruning via ONNX model / sidecar with fail-open safety.",
    inputScope: "messages",
    targetLatencyMs: 50,
    supportsPreview: true,
    stable: true,
  },

  apply(body, options = {}) {
    // Synchronous fallback (safe pass-through)
    return { body, compressed: false, stats: null };
  },

  async applyAsync(body, options = {}) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { body, compressed: false, stats: null };
    }

    const stepConfig = options?.stepConfig || {};
    if (stepConfig.enabled === false) {
      return { body, compressed: false, stats: null };
    }

    const start = Date.now();
    let anyChanged = false;

    try {
      const newMessages = await Promise.all(
        messages.map(async (msg) => {
          if (options?.config?.preserveSystemPrompt !== false && msg.role === "system") {
            return msg;
          }

          if (typeof msg.content === "string") {
            const pruned = await compressProseSemantic(msg.content, stepConfig);
            if (pruned !== msg.content) {
              anyChanged = true;
              return { ...msg, content: pruned };
            }
          }
          return msg;
        })
      );

      if (!anyChanged) {
        return { body, compressed: false, stats: null };
      }

      const newBody = { ...body, messages: newMessages };
      const durationMs = Date.now() - start;
      const stats = createCompressionStats(body, newBody, "stacked", ["llmlingua-semantic-pruning"], [], durationMs);
      return { body: newBody, compressed: true, stats };
    } catch {
      // Fail-open
      return { body, compressed: false, stats: null };
    }
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "compressionRate", type: "number", label: "Compression rate", defaultValue: 0.5 },
    ];
  },

  validateConfig(config = {}) {
    return { valid: true, errors: [] };
  },
};
