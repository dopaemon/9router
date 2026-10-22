// Aggressive compression engine (9)
// Summarization + progressive aging of old turns
// Matches https://github.com/cheaper-inference/OmniRoute

import { createCompressionStats } from "../../stats.js";
import { DEFAULT_AGGRESSIVE_CONFIG } from "../../types.js";
import { compressProse } from "../caveman/index.js";

const ENGINE_ID = "aggressive";

function summarizeMessage(content, maxTokens = 512) {
  if (typeof content !== "string") return content;
  const lines = content.split("\n");
  if (lines.length <= 15) return content;

  const head = lines.slice(0, 6);
  const tail = lines.slice(-4);
  const omitted = lines.length - head.length - tail.length;
  return `${head.join("\n")}\n\n[... ${omitted} lines summarized ...]\n\n${tail.join("\n")}`;
}

export function applyAging(messages, thresholds = { verbatim: 2, light: 2, moderate: 3 }, preserveSystem = true) {
  const lastUserIdx = messages.findLastIndex((m) => m.role === "user");
  const total = messages.length;

  return messages.map((msg, idx) => {
    if (preserveSystem && msg.role === "system") return msg;
    if (idx === lastUserIdx) return msg;

    const distance = total - 1 - idx;
    if (distance <= (thresholds.verbatim || 2)) return msg;

    if (typeof msg.content === "string") {
      if (distance <= (thresholds.moderate || 3)) {
        return { ...msg, content: compressProse(msg.content) };
      }
      return { ...msg, content: summarizeMessage(msg.content) };
    }

    return msg;
  });
}

export const aggressiveEngine = {
  id: ENGINE_ID,
  name: "Aggressive",
  description: "Summarization + progressive aging of older turns (~50% savings for long sessions).",
  icon: "history_edu",
  targets: ["messages", "tool_results"],
  stackable: true,
  stackPriority: 30,
  metadata: {
    id: ENGINE_ID,
    name: "Aggressive",
    description: "Summarization and progressive turn aging.",
    inputScope: "messages",
    targetLatencyMs: 2,
    supportsPreview: true,
    stable: true,
  },

  apply(body, options = {}) {
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { body, compressed: false, stats: null };
    }

    if (options?.stepConfig?.enabled === false) {
      return { body, compressed: false, stats: null };
    }
    const config = { ...DEFAULT_AGGRESSIVE_CONFIG, enabled: true, ...(options?.stepConfig || {}) };

    const start = Date.now();
    const preserveSystem = options?.config?.preserveSystemPrompt !== false;
    const agedMessages = applyAging(messages, config.thresholds, preserveSystem);

    const newBody = { ...body, messages: agedMessages };
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(body, newBody, "aggressive", ["turn-aging", "summarization"], [], durationMs);
    return { body: newBody, compressed: true, stats };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "maxTokensPerMessage", type: "number", label: "Max tokens per message", defaultValue: 2048 },
    ];
  },

  validateConfig(config = {}) {
    return { valid: true, errors: [] };
  },
};
