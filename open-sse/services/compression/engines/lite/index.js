// Lite compression engine (3)
// Whitespace + image-URL trimming + fast safe tool truncation (latency-light baseline)
// Matches https://github.com/cheaper-inference/OmniRoute

import { createCompressionStats } from "../../stats.js";

const ENGINE_ID = "lite";
const DEFAULT_MAX_TOOL_LENGTH = 2000;
const TOOL_TRUNCATION_LOOKBACK = 80;

function isWordChar(char) {
  return char !== undefined && /\S/.test(char);
}

function backOffToWordBoundary(content, cutIndex) {
  if (cutIndex >= content.length) return cutIndex;
  const onWordBoundary = !isWordChar(content[cutIndex - 1]) || !isWordChar(content[cutIndex]);
  if (onWordBoundary) return cutIndex;

  const windowStart = Math.max(0, cutIndex - TOOL_TRUNCATION_LOOKBACK);
  for (let i = cutIndex; i > windowStart; i--) {
    if (!isWordChar(content[i - 1])) return i - 1;
  }
  return cutIndex;
}

function truncateToolText(text, maxLength) {
  if (text.length <= maxLength) return text;
  const cutIndex = backOffToWordBoundary(text, maxLength);
  return text.slice(0, cutIndex) + "\n...[truncated]";
}

export function collapseWhitespace(messages, preserveSystemPrompt = true) {
  let applied = false;
  const updated = messages.map((msg) => {
    if (preserveSystemPrompt && msg.role === "system") return msg;
    if (typeof msg.content !== "string") return msg;
    const normalized = msg.content.replace(/\n{3,}/g, "\n\n").replace(/[ \t]+$/gm, "");
    if (normalized !== msg.content) applied = true;
    return { ...msg, content: normalized };
  });
  return { messages: updated, applied };
}

export function dedupSystemPrompt(messages, preserveSystemPrompt = true) {
  if (preserveSystemPrompt) return { messages, applied: false };
  const seen = new Set();
  let applied = false;
  const updated = messages.filter((msg) => {
    if (msg.role !== "system" || typeof msg.content !== "string") return true;
    const key = msg.content.trim().slice(0, 200);
    if (seen.has(key)) {
      applied = true;
      return false;
    }
    seen.add(key);
    return true;
  });
  return { messages: updated, applied };
}

export function compressToolResults(messages, maxToolLength = DEFAULT_MAX_TOOL_LENGTH) {
  let applied = false;
  let lastAssistant = -1;
  for (let i = messages.length - 1; i >= 0; i--) {
    if (messages[i].role === "assistant") {
      lastAssistant = i;
      break;
    }
  }
  const currentTurnStart = lastAssistant === -1 ? messages.length : lastAssistant + 1;

  const updated = messages.map((msg, index) => {
    if (index >= currentTurnStart) return msg;

    if (msg.role === "tool" && typeof msg.content === "string") {
      const truncated = truncateToolText(msg.content, maxToolLength);
      if (truncated !== msg.content) {
        applied = true;
        return { ...msg, content: truncated };
      }
      return msg;
    }

    if (msg.role === "user" && Array.isArray(msg.content)) {
      let blockApplied = false;
      const newContent = msg.content.map((part) => {
        if (part?.type === "tool_result" && typeof part.content === "string") {
          const truncated = truncateToolText(part.content, maxToolLength);
          if (truncated !== part.content) {
            blockApplied = true;
            return { ...part, content: truncated };
          }
        }
        return part;
      });
      if (blockApplied) {
        applied = true;
        return { ...msg, content: newContent };
      }
    }

    return msg;
  });

  return { messages: updated, applied };
}

export function replaceImageUrls(messages, supportsVision = true) {
  if (supportsVision !== false) return { messages, applied: false };
  let applied = false;

  const updated = messages.map((msg) => {
    if (!Array.isArray(msg.content)) return msg;
    let contentChanged = false;
    const newContent = msg.content.map((part) => {
      if (part?.type === "image_url" && part.image_url?.url?.startsWith("data:image/")) {
        contentChanged = true;
        applied = true;
        const url = part.image_url.url;
        const format = url.slice(url.indexOf("/") + 1, url.indexOf(";")) || "image";
        return { type: "text", text: `[image: ${format}]` };
      }
      return part;
    });
    return contentChanged ? { ...msg, content: newContent } : msg;
  });

  return { messages: updated, applied };
}

export const liteEngine = {
  id: ENGINE_ID,
  name: "Lite",
  description: "Fast whitespace, tool-result and image URL reduction.",
  icon: "compress",
  targets: ["messages", "tool_results"],
  stackable: true,
  stackPriority: 5,
  metadata: {
    id: ENGINE_ID,
    name: "Lite",
    description: "Fast whitespace and tool-result reduction.",
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

    const stepConfig = options?.stepConfig ?? {};
    if (stepConfig.enabled === false) {
      return { body, compressed: false, stats: null };
    }

    const preserveSystemPrompt = options?.config?.preserveSystemPrompt !== false;
    const compressTools = stepConfig.compressToolResults ?? true;
    const maxToolLength = typeof stepConfig.maxToolLength === "number" ? stepConfig.maxToolLength : DEFAULT_MAX_TOOL_LENGTH;
    const supportsVision = options?.supportsVision !== false;

    const start = Date.now();
    let current = messages;
    const techniques = [];

    const ws = collapseWhitespace(current, preserveSystemPrompt);
    if (ws.applied) { current = ws.messages; techniques.push("collapse-whitespace"); }

    const dedup = dedupSystemPrompt(current, preserveSystemPrompt);
    if (dedup.applied) { current = dedup.messages; techniques.push("dedup-system-prompt"); }

    if (compressTools) {
      const tools = compressToolResults(current, maxToolLength);
      if (tools.applied) { current = tools.messages; techniques.push("compress-tool-results"); }
    }

    const img = replaceImageUrls(current, supportsVision);
    if (img.applied) { current = img.messages; techniques.push("replace-image-urls"); }

    if (techniques.length === 0) {
      return { body, compressed: false, stats: null };
    }

    const newBody = { ...body, messages: current };
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(body, newBody, "lite", techniques, [], durationMs);
    return { body: newBody, compressed: true, stats };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "compressToolResults", type: "boolean", label: "Truncate tool results", defaultValue: true },
      { key: "maxToolLength", type: "number", label: "Max tool length", defaultValue: DEFAULT_MAX_TOOL_LENGTH },
    ];
  },

  validateConfig(config = {}) {
    const errors = [];
    if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
      errors.push("enabled must be a boolean");
    }
    if (config.maxToolLength !== undefined && (typeof config.maxToolLength !== "number" || config.maxToolLength < 1)) {
      errors.push("maxToolLength must be a positive number");
    }
    return { valid: errors.length === 0, errors };
  },
};
