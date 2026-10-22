// Relevance compression engine (7)
// Extractive sentence scoring against the last user query
// Matches https://github.com/cheaper-inference/OmniRoute

import { createCompressionStats } from "../../stats.js";
import { DEFAULT_RELEVANCE_CONFIG } from "../../types.js";

const ENGINE_ID = "relevance";

const SENTENCE_PRESERVE_RE =
  /\d|https?:\/\/|(?:Error|Exception|TypeError|RangeError|SyntaxError|ReferenceError|Traceback):|```|^\s*at\s|\/[\w.-]+\/|\w+=\S/i;

const SENTENCE_SPLIT_RE = /(?<=[.!?]\s)/;

const BOILERPLATE_TOKENS = new Set([
  "please", "note", "important", "indeed", "certainly", "basically", "essentially",
  "obviously", "clearly", "simply", "just", "really", "actually", "honestly",
  "conclusion", "summary", "hope", "understand", "thing", "things", "something",
]);

function tokenize(text) {
  const lower = text.toLowerCase();
  const tokens = [];
  let start = -1;
  for (let i = 0; i <= lower.length; i++) {
    const ch = i < lower.length ? lower.charCodeAt(i) : -1;
    const isAlnum = ch !== -1 && ((ch >= 97 && ch <= 122) || (ch >= 48 && ch <= 57));
    if (isAlnum) {
      if (start === -1) start = i;
    } else {
      if (start !== -1) {
        tokens.push(lower.slice(start, i));
        start = -1;
      }
    }
  }
  return tokens;
}

function jaccard(setA, setB) {
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection++;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function boilerplateScore(tokens) {
  if (tokens.length === 0) return 0;
  let count = 0;
  for (const t of tokens) {
    if (BOILERPLATE_TOKENS.has(t)) count++;
  }
  return count / tokens.length;
}

function scoreSentences(sentences, query, cfg) {
  if (sentences.length === 0) return [];
  if (!query || query.trim().length === 0) return sentences.map(() => 0);

  const queryTokens = new Set(tokenize(query));
  return sentences.map((sentence) => {
    const sentTokens = tokenize(sentence);
    if (sentTokens.length === 0) return 0;
    const sentSet = new Set(sentTokens);
    const overlap = jaccard(sentSet, queryTokens);
    const boilerplate = boilerplateScore(sentTokens) * (cfg.boilerplateWeight || 0.5);
    return Math.max(0, overlap - boilerplate);
  });
}

function splitSentences(text) {
  return text.split(SENTENCE_SPLIT_RE).filter((s) => s.trim().length > 0);
}

function applyRelevanceToText(text, query, cfg) {
  const sentences = splitSentences(text);
  if (sentences.length <= 1) return { result: text, changed: false };

  const scores = scoreSentences(sentences, query, cfg);
  const totalChars = text.length;
  const budget = Math.floor(totalChars * (cfg.budgetPercent || 0.5));

  const indexed = sentences.map((s, i) => ({ s, i, score: scores[i] }));
  const sorted = [...indexed].sort((a, b) => b.score - a.score);
  const keepSet = new Set();

  // Force-preserved sentences
  for (const { s, i } of indexed) {
    if (SENTENCE_PRESERVE_RE.test(s)) keepSet.add(i);
  }

  let kept = 0;
  const threshold = cfg.overlapThreshold || 0.1;
  for (const { s, i, score } of sorted) {
    if (keepSet.has(i)) continue;
    if (kept >= budget) break;
    if (score >= threshold) {
      keepSet.add(i);
      kept += s.length + 1;
    }
  }

  if (keepSet.size === 0 && sorted.length > 0) keepSet.add(sorted[0].i);
  if (keepSet.size === sentences.length) return { result: text, changed: false };

  const ordered = indexed.filter(({ i }) => keepSet.has(i)).sort((a, b) => a.i - b.i);
  const result = ordered.map(({ s }) => s).join("");
  return { result, changed: result !== text };
}

function extractText(content) {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((b) => (b && typeof b === "object" && b.text ? String(b.text) : "")).join(" ");
  }
  return "";
}

export const relevanceEngine = {
  id: ENGINE_ID,
  name: "Relevance",
  description: "Extractive sentence scoring against the last user query.",
  icon: "target",
  targets: ["messages"],
  stackable: true,
  stackPriority: 18,
  metadata: {
    id: ENGINE_ID,
    name: "Relevance",
    description: "Extractive sentence scoring against the last user query.",
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
    const stepConfig = { ...DEFAULT_RELEVANCE_CONFIG, enabled: true, ...(options?.stepConfig || {}) };

    // Find last user query
    let query = "";
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i]?.role === "user") {
        query = extractText(messages[i].content).trim();
        break;
      }
    }
    if (!query) return { body, compressed: false, stats: null };

    const start = Date.now();
    let anyChanged = false;

    const newMessages = messages.map((msg) => {
      if (msg.role !== "user") return msg;

      if (typeof msg.content === "string") {
        const { result, changed } = applyRelevanceToText(msg.content, query, stepConfig);
        if (changed) {
          anyChanged = true;
          return { ...msg, content: result };
        }
      }

      return msg;
    });

    if (!anyChanged) return { body, compressed: false, stats: null };

    const newBody = { ...body, messages: newMessages };
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(body, newBody, "stacked", ["relevance-extract"], [], durationMs);
    return { body: newBody, compressed: true, stats };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "overlapThreshold", type: "number", label: "Overlap threshold", defaultValue: 0.1 },
      { key: "budgetPercent", type: "number", label: "Budget percent", defaultValue: 0.5 },
    ];
  },

  validateConfig(config = {}) {
    return { valid: true, errors: [] };
  },
};
