// Ultra compression engine (11)
// Maximum compression: heuristic token pruning with an optional SLM tier
// Matches https://github.com/cheaper-inference/OmniRoute

import { extractPreservedBlocks, restorePreservedBlocks } from "../../preservation.js";
import { createCompressionStats } from "../../stats.js";
import { DEFAULT_ULTRA_CONFIG } from "../../types.js";

const ENGINE_ID = "ultra";

const STOPWORDS = new Set([
  "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
  "have", "has", "had", "will", "would", "could", "may", "might", "shall",
  "dare", "ought", "used", "i", "we", "you", "he", "she", "it", "they",
  "me", "us", "him", "her", "them", "my", "our", "your", "his", "its",
  "their", "this", "that", "these", "those", "and", "but", "or", "for",
  "yet", "so", "as", "at", "by", "in", "of", "on", "to", "up", "via",
  "with", "from", "into", "onto", "upon", "about", "just", "very", "really",
  "quite", "rather", "also", "too", "even", "still", "already", "often",
  "usually", "sometimes", "here", "there",
]);

const POLARITY_WORDS = new Set([
  "never", "always", "no", "not", "nor", "must", "shall", "shall not",
  "do", "does", "did", "don't", "doesn't", "didn't", "can", "cannot",
  "can't", "should", "shouldn't", "need", "needs", "mustn't", "won't",
  "wouldn't", "could", "couldn't",
]);

const FORCE_PRESERVE_RE = /\d|https?:\/\/|[._\/\\]|Error:|Exception:|```/i;

function scoreToken(token) {
  if (FORCE_PRESERVE_RE.test(token)) return 1.0;
  const lower = token.toLowerCase();
  if (POLARITY_WORDS.has(lower)) return 1.0;
  if (STOPWORDS.has(lower)) return 0.1;
  if (token.length <= 2) return 0.2;
  if (/^[A-Z]/.test(token)) return 0.8;
  if (token.length >= 6) return 0.7;
  return 0.5;
}

export function pruneByScore(text, keepRate = 0.5, minScore = 0.3) {
  if (!text || keepRate >= 1) return text;

  const tokens = text.split(/(\s+)/);
  const wordTokens = tokens.filter((t) => !/^\s+$/.test(t));
  const targetKeep = Math.ceil(wordTokens.length * keepRate);

  const scored = wordTokens.map((t, i) => ({ t, i, score: scoreToken(t) }));
  const sorted = [...scored].sort((a, b) => a.score - b.score);
  const toPrune = new Set();
  let pruned = 0;

  for (const { i, score } of sorted) {
    if (pruned >= wordTokens.length - targetKeep) break;
    if (score < minScore) {
      toPrune.add(i);
      pruned++;
    }
  }

  let wordIdx = 0;
  return tokens
    .map((t) => {
      if (/^\s+$/.test(t)) return t;
      const keep = !toPrune.has(wordIdx);
      wordIdx++;
      return keep ? t : "";
    })
    .join("")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function pruneProseOnly(text, rate, minScore) {
  const { text: withPlaceholders, blocks } = extractPreservedBlocks(text);
  const pruned = pruneByScore(withPlaceholders, 1 - rate, minScore);
  return restorePreservedBlocks(pruned, blocks);
}

export const ultraEngine = {
  id: ENGINE_ID,
  name: "Ultra",
  description: "Maximum compression mode (~75%): heuristic token pruning + code-block thinning.",
  icon: "bolt",
  targets: ["messages"],
  stackable: true,
  stackPriority: 40,
  metadata: {
    id: ENGINE_ID,
    name: "Ultra",
    description: "Heuristic token pruning with information-density scoring.",
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
    const config = { ...DEFAULT_ULTRA_CONFIG, enabled: true, ...(options?.stepConfig || {}) };

    const start = Date.now();
    let anyChanged = false;

    const newMessages = messages.map((msg) => {
      if (options?.config?.preserveSystemPrompt !== false && msg.role === "system") {
        return msg;
      }

      if (typeof msg.content === "string") {
        const pruned = pruneProseOnly(msg.content, config.compressionRate || 0.5, config.minScoreThreshold || 0.3);
        if (pruned !== msg.content) {
          anyChanged = true;
          return { ...msg, content: pruned };
        }
      }

      return msg;
    });

    if (!anyChanged) {
      return { body, compressed: false, stats: null };
    }

    const newBody = { ...body, messages: newMessages };
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(body, newBody, "ultra", ["ultra-heuristic-pruning"], [], durationMs);
    return { body: newBody, compressed: true, stats };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "compressionRate", type: "number", label: "Compression rate", defaultValue: 0.5 },
      { key: "minScoreThreshold", type: "number", label: "Min score threshold", defaultValue: 0.3 },
    ];
  },

  validateConfig(config = {}) {
    return { valid: true, errors: [] };
  },
};
