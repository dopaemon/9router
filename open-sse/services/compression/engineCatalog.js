// Engine catalog defining metadata, guidance, priorities, and tradeoffs for all 12 compression engines.
// Matches https://github.com/cheaper-inference/OmniRoute

export const ENGINE_CATALOG = {
  "session-dedup": {
    id: "session-dedup",
    label: "Session Dedup",
    stackPriority: 3,
    isSingleMode: false,
    description: "Cross-turn block deduplication.",
    guidance: {
      tradeoffs:
        "Lossless — elides only text already sent earlier in the same session; nothing is summarized or dropped. Negligible latency overhead.",
      lossy: false,
      cacheImpact: "low",
    },
  },
  ccr: {
    id: "ccr",
    label: "CCR (Retrieval)",
    stackPriority: 4,
    isSingleMode: false,
    description: "Content-addressed retrieval markers.",
    guidance: {
      tradeoffs:
        "Lossless — replaces large repeated/contiguous blocks with content-addressed references instead of deleting them; the original content stays retrievable.",
      lossy: false,
      cacheImpact: "low",
    },
  },
  lite: {
    id: "lite",
    label: "Lite",
    stackPriority: 5,
    isSingleMode: true,
    description: "Whitespace/format cleanup.",
    guidance: {
      tradeoffs:
        "Safest mode (~15% savings, <1ms latency): whitespace/dedup/formatting cleanup only, zero semantic change. Always safe to leave on.",
      lossy: false,
      cacheImpact: "none",
    },
  },
  rtk: {
    id: "rtk",
    label: "RTK",
    stackPriority: 10,
    levels: ["minimal", "standard", "aggressive"],
    isSingleMode: true,
    description: "Command-output filtering.",
    guidance: {
      tradeoffs:
        "Strips ANSI noise, progress bars, and repeated lines from command/tool output while preserving failures, warnings, and summaries (60-90% upstream savings).",
      lossy: true,
      cacheImpact: "moderate",
    },
  },
  "codex-responses": {
    id: "codex-responses",
    label: "Responses Tool Output",
    stackPriority: 12,
    isSingleMode: true,
    description: "Conservative compression for supported Responses tool outputs.",
    guidance: {
      tradeoffs:
        "Lossless-first JSON and bounded diagnostic compression for shell, patch, search, and build outputs. Protected tools and uncertain shapes pass through unchanged.",
      lossy: true,
      cacheImpact: "low",
    },
  },
  headroom: {
    id: "headroom",
    label: "Headroom",
    stackPriority: 15,
    isSingleMode: false,
    description: "Tabular JSON compaction.",
    guidance: {
      tradeoffs:
        "Lossless columnar compaction (SmartCrusher) of homogeneous JSON-array payloads into a compact '[N rows]' form — no data is discarded.",
      lossy: false,
      cacheImpact: "low",
    },
  },
  relevance: {
    id: "relevance",
    label: "Relevance",
    stackPriority: 18,
    isSingleMode: true,
    description: "Extractive sentence scoring against the last user query.",
    guidance: {
      tradeoffs:
        "Drops sentences scored as less relevant to the last user query — output depends on the query, so it can omit context a later turn needs.",
      lossy: true,
      cacheImpact: "moderate",
    },
  },
  caveman: {
    id: "caveman",
    label: "Caveman",
    stackPriority: 20,
    levels: ["lite", "full", "ultra"],
    isSingleMode: true,
    description: "Rule-based prose compression.",
    guidance: {
      tradeoffs:
        "Rule-based prose condensation (~30% savings at 'full'): strips filler and hedging while preserving meaning, but rewrites text so it is not byte-identical to the original.",
      lossy: true,
      cacheImpact: "moderate",
    },
  },
  aggressive: {
    id: "aggressive",
    label: "Aggressive",
    stackPriority: 30,
    isSingleMode: true,
    description: "Summarize + age old turns.",
    guidance: {
      tradeoffs:
        "Summarizes and progressively ages older turns (~50% savings) — trades older-turn fidelity for context headroom in long sessions.",
      lossy: true,
      cacheImpact: "high",
    },
  },
  llmlingua: {
    id: "llmlingua",
    label: "LLMLingua (SLM)",
    stackPriority: 35,
    isSingleMode: false,
    description: "Semantic pruning (ONNX).",
    guidance: {
      tradeoffs:
        "Semantic token pruning via a small ONNX classifier — removes individual tokens judged low-information. Fail-opens on any error.",
      lossy: true,
      cacheImpact: "high",
    },
  },
  ultra: {
    id: "ultra",
    label: "Ultra",
    stackPriority: 40,
    isSingleMode: true,
    description: "Heuristic token pruning (+ optional SLM).",
    guidance: {
      tradeoffs:
        "Maximum-compression mode (~75% savings): heuristic pruning, code-block thinning, and binary-search truncation.",
      lossy: true,
      cacheImpact: "high",
    },
  },
  omniglyph: {
    id: "omniglyph",
    label: "OmniGlyph",
    stackPriority: 90,
    isSingleMode: true,
    description: "Context-as-image encoding (Claude Fable 5, direct route).",
    guidance: {
      tradeoffs:
        "Experimental context-as-image encoding routed directly to Claude Fable 5 only — the most aggressive and least broadly compatible option.",
      lossy: true,
      cacheImpact: "high",
    },
  },
};

export const ENGINE_IDS = Object.values(ENGINE_CATALOG)
  .sort((a, b) => a.stackPriority - b.stackPriority)
  .map((e) => e.id);

export function engineMeta(id) {
  return ENGINE_CATALOG[id] || null;
}

export function isSafeDefault(id) {
  const meta = engineMeta(id);
  return meta ? !meta.guidance.lossy : false;
}
