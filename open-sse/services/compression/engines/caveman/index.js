// Caveman prose compression engine (8)
// Rule-based message condensation with code and syntax preservation
// Matches https://github.com/cheaper-inference/OmniRoute

import { extractPreservedBlocks, restorePreservedBlocks } from "../../preservation.js";
import { createCompressionStats } from "../../stats.js";
import { DEFAULT_CAVEMAN_CONFIG } from "../../types.js";

const ENGINE_ID = "caveman";

export const CAVEMAN_RULES = [
  { name: "pleasantries", pattern: /\b(?:please|kindly|could you please|would you mind|thank you|thanks in advance|glad to help)\b/gi, replacement: "" },
  { name: "filler_adverbs", pattern: /\b(?:basically|essentially|actually|literally|simply|currently|certainly|obviously)\b/gi, replacement: "" },
  { name: "verbose_connectors", pattern: /\b(?:in order to|so as to)\b/gi, replacement: "to" },
  { name: "because_connector", pattern: /\b(?:due to the fact that|owing to the fact that)\b/gi, replacement: "because" },
  { name: "hedging", pattern: /\b(?:it seems like|it appears that|i think that|i believe that|in my opinion)\b/gi, replacement: "" },
  { name: "self_reference", pattern: /\b(?:i am trying to|i want to|i would like to|i'm looking to)\b/gi, replacement: "" },
  { name: "meta_commentary", pattern: /\b(?:note that|keep in mind that|remember that)\b/gi, replacement: "" },
  { name: "excessive_quantifiers", pattern: /\b(?:each and every|any and all)\b/gi, replacement: "all" },
  { name: "redundant_phrasing", pattern: /\b(?:make sure that you|be sure to)\b/gi, replacement: "" },
];

function applyRules(text, rules = CAVEMAN_RULES) {
  let result = text;
  for (const rule of rules) {
    result = result.replace(rule.pattern, rule.replacement);
  }
  return result
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([,.;:!?])/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function compressProse(text, config = DEFAULT_CAVEMAN_CONFIG) {
  if (typeof text !== "string" || text.length < (config.minMessageLength || 50)) {
    return text;
  }

  // Preserve code blocks, inline code, URLs, math, errors
  const { text: withPlaceholders, blocks } = extractPreservedBlocks(text, {
    preservePatterns: config.preservePatterns,
  });

  const compressedText = applyRules(withPlaceholders);
  return restorePreservedBlocks(compressedText, blocks);
}

export const cavemanEngine = {
  id: ENGINE_ID,
  name: "Caveman",
  description: "Rule-based prose compression: removes filler and verbose phrasing while preserving code.",
  icon: "psychology",
  targets: ["messages"],
  stackable: true,
  stackPriority: 20,
  metadata: {
    id: ENGINE_ID,
    name: "Caveman",
    description: "Rule-based prose compression.",
    inputScope: "messages",
    targetLatencyMs: 1,
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
    const stepConfig = { ...DEFAULT_CAVEMAN_CONFIG, enabled: true, ...(options?.stepConfig || {}) };

    const start = Date.now();
    let anyChanged = false;

    const newMessages = messages.map((msg) => {
      if (options?.config?.preserveSystemPrompt !== false && msg.role === "system") {
        return msg;
      }

      if (typeof msg.content === "string") {
        const compressed = compressProse(msg.content, stepConfig);
        if (compressed !== msg.content) {
          anyChanged = true;
          return { ...msg, content: compressed };
        }
      }

      return msg;
    });

    if (!anyChanged) {
      return { body, compressed: false, stats: null };
    }

    const newBody = { ...body, messages: newMessages };
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(body, newBody, "standard", ["caveman-rules"], [], durationMs);
    return { body: newBody, compressed: true, stats };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "intensity", type: "select", label: "Intensity", defaultValue: "full", options: [{ value: "lite", label: "lite" }, { value: "full", label: "full" }, { value: "ultra", label: "ultra" }] },
      { key: "minMessageLength", type: "number", label: "Min message length", defaultValue: 50 },
    ];
  },

  validateConfig(config = {}) {
    return { valid: true, errors: [] };
  },
};
