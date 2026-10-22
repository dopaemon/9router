// Session-Dedup compression engine (1)
// Content-addressed cross-turn deduplication (TokenMizer blueprint)
// Matches https://github.com/cheaper-inference/OmniRoute

import crypto from "node:crypto";
import { createCompressionStats } from "../../stats.js";

const ENGINE_ID = "session-dedup";
const DEFAULT_MIN_BLOCK_CHARS = 80;
const MIN_BLOCK_LINES = 3;
const MAX_SUFFIX_STARTS = 2000;
const MAX_TOTAL_BLOCK_BYTES = 8 * 1024 * 1024;

function hashBlock(text) {
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 24);
}

function findSuffixBlocks(lines, minBlockChars) {
  const n = lines.length;
  const seen = new Set();
  const results = [];
  const maxStarts = Math.min(n, MAX_SUFFIX_STARTS);
  let totalBlockBytes = 0;

  for (let start = 0; start < maxStarts; start++) {
    const block = lines.slice(start).join("\n");
    const blockLines = n - start;
    if (blockLines >= MIN_BLOCK_LINES && block.length >= minBlockChars && !seen.has(block)) {
      seen.add(block);
      results.push({ block, startLine: start });
      totalBlockBytes += block.length;
      if (totalBlockBytes >= MAX_TOTAL_BLOCK_BYTES) break;
    }
  }
  return results;
}

function countLiteralOccurrences(text, needle) {
  if (!needle) return 0;
  let count = 0;
  let offset = 0;
  while (true) {
    const idx = text.indexOf(needle, offset);
    if (idx === -1) return count;
    count++;
    offset = idx + needle.length;
  }
}

function replaceLiteralOccurrencesAfterFirst(text, needle, replacement) {
  if (!needle) return text;
  const first = text.indexOf(needle);
  if (first === -1) return text;

  let result = text.slice(0, first + needle.length);
  let offset = first + needle.length;

  while (true) {
    const idx = text.indexOf(needle, offset);
    if (idx === -1) {
      result += text.slice(offset);
      return result;
    }
    result += text.slice(offset, idx) + replacement;
    offset = idx + needle.length;
  }
}

function dedupeWithinMessage(text, minBlockChars) {
  const lines = text.split("\n");
  const blocks = findSuffixBlocks(lines, minBlockChars);
  if (blocks.length < 2) return { deduped: text, changed: false };

  const blockFreq = new Map();
  for (const { block } of blocks) {
    blockFreq.set(block, (blockFreq.get(block) || 0) + 1);
  }

  const sortedBlocks = [...blocks].sort((a, b) => {
    const freqDiff = (blockFreq.get(b.block) || 0) - (blockFreq.get(a.block) || 0);
    return freqDiff !== 0 ? freqDiff : b.block.length - a.block.length;
  });

  let result = text;
  let changed = false;

  for (const { block } of sortedBlocks) {
    const occurrences = countLiteralOccurrences(result, block);
    if (occurrences < 2) continue;

    const sha = hashBlock(block);
    const marker = `[dedup:ref sha=${sha}]`;
    result = replaceLiteralOccurrencesAfterFirst(result, block, marker);
    changed = true;
  }

  return { deduped: result, changed };
}

function dedupMessageTexts(msgTexts, minBlockChars, currentTurnStart) {
  const deduped = new Map();
  let dedupCount = 0;

  if (msgTexts.length === 1) {
    const { text, msgIdx } = msgTexts[0];
    const { deduped: dedupedText, changed } = dedupeWithinMessage(text, minBlockChars);
    if (changed) {
      deduped.set(msgIdx, dedupedText);
      dedupCount++;
    }
    return { deduped, dedupCount };
  }

  const firstSeen = new Map();

  for (const { msgIdx, text } of msgTexts) {
    const lines = text.split("\n");
    const blocks = findSuffixBlocks(lines, minBlockChars);
    for (const { block } of blocks) {
      const sha = hashBlock(block);
      if (!firstSeen.has(sha)) {
        firstSeen.set(sha, { ownerMsgIdx: msgIdx, block });
      }
    }
  }

  for (const { msgIdx, messageIndex, text } of msgTexts) {
    if (messageIndex >= currentTurnStart) continue;
    const lines = text.split("\n");
    const blocks = findSuffixBlocks(lines, minBlockChars);

    const dupBlocks = [];
    for (const { block } of blocks) {
      const sha = hashBlock(block);
      const owner = firstSeen.get(sha);
      if (owner && owner.ownerMsgIdx < msgIdx && owner.block === block) {
        dupBlocks.push({ block, sha });
      }
    }

    if (dupBlocks.length === 0) continue;
    dupBlocks.sort((a, b) => b.block.length - a.block.length);

    let result = text;
    let changed = false;
    const replaced = new Set();

    for (const { block, sha } of dupBlocks) {
      if ([...replaced].some((r) => r.includes(block))) continue;

      const idx = result.indexOf(block);
      if (idx !== -1) {
        const marker = `[dedup:ref sha=${sha}]`;
        result = result.slice(0, idx) + marker + result.slice(idx + block.length);
        changed = true;
        replaced.add(block);
        break;
      }
    }

    if (changed) {
      deduped.set(msgIdx, result);
      dedupCount++;
    }
  }

  return { deduped, dedupCount };
}

function collectTextSlots(msg) {
  if (!msg) return [];
  if (typeof msg.content === "string") return [msg.content];
  if (!Array.isArray(msg.content)) return [];
  const texts = [];
  for (const part of msg.content) {
    if (part?.type === "text" && typeof part.text === "string") {
      texts.push(part.text);
      continue;
    }
    if (part?.type === "tool_result") {
      if (typeof part.content === "string") {
        texts.push(part.content);
      } else if (Array.isArray(part.content)) {
        for (const block of part.content) {
          if (block?.type === "text" && typeof block.text === "string") {
            texts.push(block.text);
          }
        }
      }
    }
  }
  return texts;
}

function applyTextSlots(msg, baseKey, deduped) {
  if (typeof msg.content === "string") {
    const replacement = deduped.get(baseKey + 1);
    return replacement !== undefined ? { ...msg, content: replacement } : { ...msg };
  }
  if (!Array.isArray(msg.content)) return { ...msg };

  let slot = 0;
  let changed = false;
  const newContent = msg.content.map((part) => {
    if (part?.type === "text" && typeof part.text === "string") {
      slot++;
      const replacement = deduped.get(baseKey + slot);
      if (replacement !== undefined) {
        changed = true;
        return { ...part, text: replacement };
      }
      return part;
    }
    if (part?.type !== "tool_result") return part;
    if (typeof part.content === "string") {
      slot++;
      const replacement = deduped.get(baseKey + slot);
      if (replacement !== undefined) {
        changed = true;
        return { ...part, content: replacement };
      }
      return part;
    }
    if (!Array.isArray(part.content)) return part;
    let innerChanged = false;
    const newInner = part.content.map((block) => {
      if (block?.type !== "text" || typeof block.text !== "string") return block;
      slot++;
      const replacement = deduped.get(baseKey + slot);
      if (replacement !== undefined) {
        innerChanged = true;
        return { ...block, text: replacement };
      }
      return block;
    });
    if (!innerChanged) return part;
    changed = true;
    return { ...part, content: newInner };
  });
  return changed ? { ...msg, content: newContent } : { ...msg };
}

function processMessages(messages, minBlockChars) {
  const msgTexts = [];
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (!msg || msg.role === "system") continue;
    const slots = collectTextSlots(msg);
    for (let s = 0; s < slots.length; s++) {
      msgTexts.push({ msgIdx: i * 100000 + s + 1, messageIndex: i, text: slots[s] });
    }
  }

  if (msgTexts.length === 0) return { messages, dedupCount: 0 };

  let currentTurnStart = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      currentTurnStart = i + 1;
      break;
    }
  }

  const { deduped, dedupCount } = dedupMessageTexts(msgTexts, minBlockChars, currentTurnStart);
  if (dedupCount === 0) return { messages, dedupCount: 0 };

  const result = messages.map((msg, i) => {
    if (msg.role === "system") return { ...msg };
    return applyTextSlots(msg, i * 100000, deduped);
  });

  return { messages: result, dedupCount };
}

export const sessionDedupEngine = {
  id: ENGINE_ID,
  name: "Session Dedup",
  description: "Content-addressed cross-turn deduplication: replaces repeated blocks with short reference markers.",
  icon: "content_copy",
  targets: ["messages"],
  stackable: true,
  stackPriority: 3,
  metadata: {
    id: ENGINE_ID,
    name: "Session Dedup",
    description: "Content-addressed cross-turn deduplication.",
    inputScope: "messages",
    targetLatencyMs: 1,
    supportsPreview: true,
    stable: true,
  },

  apply(body, options = {}) {
    const stepConfig = options?.stepConfig ?? {};
    if (stepConfig.enabled === false) {
      return { body, compressed: false, stats: null };
    }

    const minBlockChars =
      typeof stepConfig.minBlockChars === "number"
        ? stepConfig.minBlockChars
        : DEFAULT_MIN_BLOCK_CHARS;

    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { body, compressed: false, stats: null };
    }

    const start = Date.now();
    const { messages: finalMessages, dedupCount } = processMessages(messages, minBlockChars);

    if (dedupCount === 0) {
      return { body, compressed: false, stats: null };
    }

    const newBody = { ...body, messages: finalMessages };
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(
      body,
      newBody,
      "stacked",
      ["session-dedup"],
      [`deduplicated-${dedupCount}-blocks`],
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
      { key: "minBlockChars", type: "number", label: "Min block chars", defaultValue: DEFAULT_MIN_BLOCK_CHARS },
    ];
  },

  validateConfig(config = {}) {
    const errors = [];
    if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
      errors.push("enabled must be a boolean");
    }
    if (config.minBlockChars !== undefined && (typeof config.minBlockChars !== "number" || config.minBlockChars < 1)) {
      errors.push("minBlockChars must be a positive number");
    }
    return { valid: errors.length === 0, errors };
  },
};
