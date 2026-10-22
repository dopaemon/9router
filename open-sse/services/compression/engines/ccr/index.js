// CCR (Content-Compression-Retrieve) compression engine (2)
// Archives large contiguous blocks behind content-addressed retrieve markers.
// Matches https://github.com/cheaper-inference/OmniRoute

import crypto from "node:crypto";
import { createCompressionStats } from "../../stats.js";

const ENGINE_ID = "ccr";
const DEFAULT_MIN_CHARS = 600;
const RETRIEVAL_THRESHOLD = 3;
const MAX_CCR_ENTRIES = 5000;
const MAX_CCR_BLOCK_BYTES = 2 * 1024 * 1024;
const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

// Principal-isolated in-memory store
const ccrStore = new Map();
const retrievalCounts = new Map();

function hashContent(content) {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 24);
}

function buildKey(hash, principalId = "__anon__") {
  return `${principalId} ${hash}`;
}

export function storeCcrBlock(content, principalId = "__anon__") {
  if (typeof content !== "string" || !content) return null;
  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_CCR_BLOCK_BYTES) return null;

  const hash = hashContent(content);
  const key = buildKey(hash, principalId);

  // Evict oldest if full
  if (ccrStore.size >= MAX_CCR_ENTRIES) {
    const oldestKey = ccrStore.keys().next().value;
    if (oldestKey) ccrStore.delete(oldestKey);
  }

  ccrStore.set(key, {
    hash,
    principalId,
    content,
    bytes,
    chars: content.length,
    createdAt: Date.now(),
    expiresAt: Date.now() + DEFAULT_TTL_MS,
  });

  return { hash, chars: content.length, bytes };
}

export function handleCcrRetrieve(hash, principalId = "__anon__") {
  if (!hash) return null;
  const key = buildKey(hash, principalId);
  const entry = ccrStore.get(key);
  if (!entry) return null;

  if (Date.now() > entry.expiresAt) {
    ccrStore.delete(key);
    return null;
  }

  // Increment retrieval counter
  const rCount = (retrievalCounts.get(key) || 0) + 1;
  retrievalCounts.set(key, rCount);

  return entry.content;
}

export function shouldSkipCcr(hash, principalId = "__anon__") {
  const key = buildKey(hash, principalId);
  return (retrievalCounts.get(key) || 0) >= RETRIEVAL_THRESHOLD;
}

function processMessageContent(content, minChars, principalId) {
  if (typeof content !== "string") return { content, replacedCount: 0 };
  if (content.length < minChars) return { content, replacedCount: 0 };

  // Check if marker would actually be shorter
  const dummyMarker = `[CCR retrieve hash=123456789012345678901234 chars=${content.length}]`;
  if (content.length <= dummyMarker.length) return { content, replacedCount: 0 };

  const hash = hashContent(content);
  if (shouldSkipCcr(hash, principalId)) return { content, replacedCount: 0 };

  const stored = storeCcrBlock(content, principalId);
  if (!stored) return { content, replacedCount: 0 };

  const marker = `[CCR retrieve hash=${stored.hash} chars=${stored.chars}]`;
  return { content: marker, replacedCount: 1 };
}

export const ccrEngine = {
  id: ENGINE_ID,
  name: "CCR (Retrieval)",
  description: "Content-addressed retrieval: archives large blocks behind retrieve markers, fetched on demand.",
  icon: "archive",
  targets: ["messages"],
  stackable: true,
  stackPriority: 4,
  metadata: {
    id: ENGINE_ID,
    name: "CCR",
    description: "Replaces large blocks with on-demand retrieve markers.",
    inputScope: "messages",
    targetLatencyMs: 2,
    supportsPreview: true,
    stable: true,
  },

  apply(body, options = {}) {
    const stepConfig = options?.stepConfig ?? {};
    if (stepConfig.enabled === false) {
      return { body, compressed: false, stats: null };
    }

    const minChars = typeof stepConfig.minChars === "number" ? stepConfig.minChars : DEFAULT_MIN_CHARS;
    const principalId = options?.principalId || "__anon__";
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { body, compressed: false, stats: null };
    }

    const start = Date.now();
    let totalReplaced = 0;

    const newMessages = messages.map((msg, idx) => {
      // Never touch system messages or the very last turn
      if (msg.role === "system" || idx === messages.length - 1) return msg;

      if (typeof msg.content === "string") {
        const { content, replacedCount } = processMessageContent(msg.content, minChars, principalId);
        totalReplaced += replacedCount;
        return { ...msg, content };
      }

      if (Array.isArray(msg.content)) {
        let changed = false;
        const newParts = msg.content.map((part) => {
          if (part?.type === "text" && typeof part.text === "string") {
            const { content, replacedCount } = processMessageContent(part.text, minChars, principalId);
            if (replacedCount > 0) {
              changed = true;
              totalReplaced += replacedCount;
              return { ...part, text: content };
            }
          }
          return part;
        });
        return changed ? { ...msg, content: newParts } : msg;
      }

      return msg;
    });

    if (totalReplaced === 0) {
      return { body, compressed: false, stats: null };
    }

    const newBody = { ...body, messages: newMessages };
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(
      body,
      newBody,
      "stacked",
      ["ccr-retrieval"],
      [`retrieved-${totalReplaced}-blocks`],
      durationMs
    );
    return { body: newBody, compressed: true, stats };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "minChars", type: "number", label: "Min characters", defaultValue: DEFAULT_MIN_CHARS },
    ];
  },

  validateConfig(config = {}) {
    const errors = [];
    if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
      errors.push("enabled must be a boolean");
    }
    if (config.minChars !== undefined && (typeof config.minChars !== "number" || config.minChars < 1)) {
      errors.push("minChars must be a positive number");
    }
    return { valid: errors.length === 0, errors };
  },
};
