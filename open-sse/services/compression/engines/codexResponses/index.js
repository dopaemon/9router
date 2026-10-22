// Responses Tool Output (codex-responses) engine (5)
// Lossless-first JSON + bounded diagnostic compression for shell/patch/search/build outputs
// Matches https://github.com/cheaper-inference/OmniRoute

import { createCompressionStats } from "../../stats.js";
import { DEFAULT_CODEX_RESPONSES_CONFIG } from "../../types.js";

const ENGINE_ID = "codex-responses";

const DIFF_HUNK_RE = /^@@{1,2}\s+-\d+(?:,\d+)?(?:\s+-\d+(?:,\d+)?)*\s+\+\d+(?:,\d+)?(?:,\d+)?\s+@@{1,2}/m;
const SEARCH_LINE_RE = /^\s*(?:[\w./-]+:\d+(?::\d+)?:|\d+(?::\d+)?[-:])\s*\S/m;
const IMPORTANT_LOG_RE = /(?:^|\b)(?:error|warning|warn|failed|failure|fatal|panic|exception|traceback|assertion|exit\s+code)\b/i;
const BUILD_RE = /\b(?:build|compile|test|lint|npm|yarn|pnpm|mix|make|cargo|gradle|maven|pytest|rspec|exunit)\b/i;

function minifyJson(text) {
  try {
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed) && (typeof parsed !== "object" || parsed === null)) return null;
    return JSON.stringify(parsed);
  } catch {
    return null;
  }
}

function collapseLines(text, config) {
  const lines = text.split(/\r?\n/);
  if (lines.length < (config.minLogLines || 24)) return null;
  const important = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => IMPORTANT_LOG_RE.test(line) || /^(?:\s*(?:at\s|File\s|\S+[:(]\d+))/.test(line))
    .map(({ index }) => index);

  if (important.length === 0 && !BUILD_RE.test(text)) return null;

  const keep = new Set();
  for (let i = 0; i < Math.min(8, lines.length); i++) keep.add(i);
  for (let i = Math.max(0, lines.length - 8); i < lines.length; i++) keep.add(i);
  for (const idx of important) {
    for (let offset = -2; offset <= 2; offset++) {
      if (idx + offset >= 0 && idx + offset < lines.length) keep.add(idx + offset);
    }
  }

  const indexes = [...keep].sort((a, b) => a - b).slice(0, config.maxLines || 160);
  const output = [];
  let prev = -1;
  for (const idx of indexes) {
    if (idx - prev > 1) output.push(`[omitted ${idx - prev - 1} lines]`);
    output.push(lines[idx]);
    prev = idx;
  }
  if (prev < lines.length - 1) output.push(`[omitted ${lines.length - prev - 1} lines]`);
  return output.join("\n");
}

function compactDiff(text, config) {
  if (!DIFF_HUNK_RE.test(text)) return null;
  const lines = text.split(/\r?\n/);
  const output = [];
  let contextCount = 0;
  for (const line of lines) {
    const changed = line.startsWith("+") || line.startsWith("-") || line.startsWith("@@");
    if (changed) {
      output.push(line);
      contextCount = 0;
    } else if (contextCount < 2) {
      output.push(line);
      contextCount++;
    }
  }
  const maxLines = (config.maxLines || 160) * 4;
  return output.length < lines.length && output.length <= maxLines ? output.join("\n") : null;
}

function compactSearch(text, config) {
  const lines = text.split(/\r?\n/);
  const matches = lines.filter((line) => SEARCH_LINE_RE.test(line));
  if (matches.length < (config.minSearchMatches || 8)) return null;
  const grouped = new Map();
  for (const line of matches) {
    const path = line.trim().split(/:\d/)[0].split(/-\d/)[0];
    const group = grouped.get(path) || [];
    if (group.length < 3) group.push(line.trim());
    grouped.set(path, group);
  }
  const output = [...grouped.entries()]
    .map(([path, entries]) => [path, ...entries].join("\n"))
    .join("\n");
  return output.length < text.length ? output : null;
}

function rewriteOutputText(text, config) {
  if (typeof text !== "string") return null;
  if (text.length < (config.minBytes || 512)) return null;
  if (text.length > (config.maxCandidateBytes || 512 * 1024)) return null;

  const candidates = [
    minifyJson(text),
    compactDiff(text, config),
    compactSearch(text, config),
    collapseLines(text, config),
  ].filter((c) => typeof c === "string" && c.length < text.length);

  if (candidates.length === 0) return null;
  candidates.sort((a, b) => a.length - b.length);
  return candidates[0];
}

export const codexResponsesEngine = {
  id: ENGINE_ID,
  name: "Responses Tool Output",
  description: "Conservative lossless-first compression for supported Responses tool outputs.",
  icon: "data_object",
  targets: ["tool_results"],
  stackable: true,
  stackPriority: 12,
  metadata: {
    id: ENGINE_ID,
    name: "Responses Tool Output",
    description: "Compresses eligible shell, patch, search, build, and JSON outputs.",
    inputScope: "tool-results",
    targetLatencyMs: 3,
    supportsPreview: true,
    stable: true,
  },

  apply(body, options = {}) {
    if (options?.stepConfig?.enabled === false) {
      return { body, compressed: false, stats: null };
    }
    const config = { ...DEFAULT_CODEX_RESPONSES_CONFIG, enabled: true, ...(options?.stepConfig || {}) };

    const items = Array.isArray(body?.input) ? body.input : Array.isArray(body?.messages) ? body.messages : null;
    if (!items || items.length === 0) {
      return { body, compressed: false, stats: null };
    }

    const start = Date.now();
    let changed = false;

    const newItems = items.map((item) => {
      if (!item || typeof item !== "object") return item;

      // Responses API: type === "function_call_output"
      if (item.type === "function_call_output") {
        if (typeof item.output === "string") {
          const next = rewriteOutputText(item.output, config);
          if (next !== null && next !== item.output) {
            changed = true;
            return { ...item, output: next };
          }
        }
        return item;
      }

      // OpenAI tool message: role === "tool"
      if (item.role === "tool" && typeof item.content === "string") {
        const next = rewriteOutputText(item.content, config);
        if (next !== null && next !== item.content) {
          changed = true;
          return { ...item, content: next };
        }
      }

      return item;
    });

    if (!changed) {
      return { body, compressed: false, stats: null };
    }

    const newBody = Array.isArray(body.input) ? { ...body, input: newItems } : { ...body, messages: newItems };
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(body, newBody, "codex-responses", ["responses-tool-output"], [], durationMs);
    return { body: newBody, compressed: true, stats };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "minBytes", type: "number", label: "Min bytes", defaultValue: 512 },
      { key: "maxLines", type: "number", label: "Max lines", defaultValue: 160 },
    ];
  },

  validateConfig(config = {}) {
    return { valid: true, errors: [] };
  },
};
