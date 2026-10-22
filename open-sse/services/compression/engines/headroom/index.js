// Headroom SmartCrusher compression engine (6)
// Lossless tabular compaction of JSON arrays (~30%)
// Matches https://github.com/cheaper-inference/OmniRoute

import { createCompressionStats } from "../../stats.js";

const ENGINE_ID = "headroom";
export const DEFAULT_MIN_ROWS = 8;
export const TABULAR_FENCE_OPEN = "```omni-tabular";
export const TABULAR_FENCE_CLOSE = "```";

function encodeCell(raw) {
  const str = String(raw);
  const needsQuoting = str.includes(",") || str.includes('"') || str.includes("\n") || str.startsWith(" ") || str.endsWith(" ");
  if (!needsQuoting) return str;
  return '"' + str.replace(/"/g, '""') + '"';
}

export function encodeTabular(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "";
  const keysSet = new Set();
  for (const row of arr) {
    if (row && typeof row === "object") {
      for (const k of Object.keys(row)) keysSet.add(k);
    }
  }
  const keys = Array.from(keysSet);
  const n = arr.length;

  const headerRow = keys.map(encodeCell).join(",");
  const dataRows = arr.map((row) => {
    return keys.map((k) => {
      const val = row ? row[k] : null;
      if (val === null || val === undefined) return "null";
      if (typeof val === "object") return encodeCell(JSON.stringify(val));
      return encodeCell(val);
    }).join(",");
  });

  return `${TABULAR_FENCE_OPEN}\n[${n} rows]\n${headerRow}\n${dataRows.join("\n")}\n${TABULAR_FENCE_CLOSE}`;
}

export function tryCompactJson(jsonStr, minRows = DEFAULT_MIN_ROWS) {
  let parsed;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    return null;
  }

  if (!Array.isArray(parsed) || parsed.length < minRows) return null;
  for (const item of parsed) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  }

  const tabular = encodeTabular(parsed);
  if (!tabular || tabular.length >= jsonStr.length) return null;
  return tabular;
}

export function crushText(text, minRows = DEFAULT_MIN_ROWS) {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const compacted = tryCompactJson(trimmed, minRows);
    if (compacted) return compacted;
  }

  const jsonFenceRe = /```json\n([\s\S]*?)\n```/g;
  let result = text;
  let offset = 0;
  let match;

  while ((match = jsonFenceRe.exec(text)) !== null) {
    const fullMatch = match[0];
    const innerJson = match[1].trim();
    const compacted = tryCompactJson(innerJson, minRows);
    if (compacted) {
      const start = match.index + offset;
      const end = start + fullMatch.length;
      result = result.slice(0, start) + compacted + result.slice(end);
      offset += compacted.length - fullMatch.length;
    }
  }

  return result;
}

export const headroomEngine = {
  id: ENGINE_ID,
  name: "Headroom",
  description: "Lossless tabular compaction of JSON arrays (~30%) into columnar format.",
  icon: "table_chart",
  targets: ["messages", "tool_results"],
  stackable: true,
  stackPriority: 15,
  metadata: {
    id: ENGINE_ID,
    name: "Headroom",
    description: "Lossless tabular compaction of homogeneous/heterogeneous JSON arrays.",
    inputScope: "messages",
    targetLatencyMs: 3,
    supportsPreview: true,
    stable: true,
  },

  apply(body, options = {}) {
    const stepConfig = options?.stepConfig ?? {};
    if (stepConfig.enabled === false) {
      return { body, compressed: false, stats: null };
    }

    const minRows = typeof stepConfig.minRows === "number" ? stepConfig.minRows : DEFAULT_MIN_ROWS;
    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return { body, compressed: false, stats: null };
    }

    const start = Date.now();
    let changed = false;

    const newMessages = messages.map((msg) => {
      if (msg.role === "system") return msg;

      if (typeof msg.content === "string") {
        const crushed = crushText(msg.content, minRows);
        if (crushed !== msg.content) {
          changed = true;
          return { ...msg, content: crushed };
        }
        return msg;
      }

      if (Array.isArray(msg.content)) {
        let blockChanged = false;
        const newParts = msg.content.map((part) => {
          if (part?.type === "text" && typeof part.text === "string") {
            const crushed = crushText(part.text, minRows);
            if (crushed !== part.text) {
              blockChanged = true;
              return { ...part, text: crushed };
            }
          }
          return part;
        });
        if (blockChanged) {
          changed = true;
          return { ...msg, content: newParts };
        }
      }

      return msg;
    });

    if (!changed) {
      return { body, compressed: false, stats: null };
    }

    const newBody = { ...body, messages: newMessages };
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(body, newBody, "stacked", ["headroom-tabular"], [], durationMs);
    return { body: newBody, compressed: true, stats };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "minRows", type: "number", label: "Min rows", defaultValue: DEFAULT_MIN_ROWS },
    ];
  },

  validateConfig(config = {}) {
    return { valid: true, errors: [] };
  },
};
