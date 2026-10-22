// Compression Pipeline Types & Defaults
// Matches https://github.com/cheaper-inference/OmniRoute

import { ENGINE_IDS } from "./engineCatalog.js";

export { ENGINE_IDS };

export const DEFAULT_CODEX_RESPONSES_CONFIG = {
  enabled: false,
  minBytes: 512,
  maxOutputBytes: 2 * 1024 * 1024,
  maxCandidateBytes: 512 * 1024,
  maxLines: 160,
  minSearchMatches: 8,
  minLogLines: 24,
  preserveToolNames: [
    "Read", "Glob", "Grep", "Write", "Edit", "WebSearch", "WebFetch",
    "read", "glob", "grep", "write", "edit", "web_search", "web_fetch",
  ],
};

export const DEFAULT_CAVEMAN_CONFIG = {
  enabled: false,
  compressRoles: ["user"],
  skipRules: [],
  minMessageLength: 50,
  preservePatterns: [
    "```[\\s\\S]*?```",
    "`[^`\\n]+`",
    "\\b(https?://\\S+)",
    "(?:^|\\s)(\\.{0,2}/[\\w./\\-]+)",
    "^\\s*(Error|TypeError|RangeError|SyntaxError|ReferenceError):",
    "^\\s+at\\s",
  ],
  intensity: "lite",
};

export const DEFAULT_CAVEMAN_OUTPUT_MODE_CONFIG = {
  enabled: false,
  intensity: "lite",
  autoClarity: true,
};

export const DEFAULT_RTK_CONFIG = {
  enabled: false,
  intensity: "minimal",
  applyToToolResults: true,
  applyToCodeBlocks: false,
  applyToAssistantMessages: false,
  enabledFilters: [],
  disabledFilters: [],
  maxLinesPerResult: 120,
  maxCharsPerResult: 12000,
  deduplicateThreshold: 3,
  customFiltersEnabled: true,
  trustProjectFilters: false,
  rawOutputRetention: "never",
  rawOutputMaxBytes: 1048576,
  rawOutputMaxFiles: 100000,
  rawOutputMaxAgeDays: 30,
  enableGrouping: false,
  groupingThreshold: 3,
  stripCodeComments: false,
  preserveDocstrings: true,
  enableRenderers: false,
};

export const DEFAULT_AGGRESSIVE_CONFIG = {
  summarizerEnabled: true,
  preserveSystemPrompt: true,
  maxTokensPerMessage: 2048,
  minSavingsThreshold: 0.1,
  thresholds: {
    verbatim: 2,
    light: 2,
    moderate: 3,
    fullSummary: 5,
  },
  toolStrategies: {
    fileContent: true,
    grepSearch: true,
    shellOutput: true,
    json: true,
    errorMessage: true,
  },
};

export const DEFAULT_ULTRA_CONFIG = {
  enabled: true,
  compressionRate: 0.5,
  minScoreThreshold: 0.3,
  slmFallbackToAggressive: true,
  preserveSystemPrompt: true,
  modelPath: "",
  maxTokensPerMessage: 0,
};

export const DEFAULT_RELEVANCE_CONFIG = {
  enabled: false,
  overlapThreshold: 0.1,
  budgetPercent: 0.5,
  boilerplateWeight: 0.5,
};

export const DEFAULT_COMPRESSION_CONFIG = {
  enabled: false,
  defaultMode: "off",
  autoTriggerMode: "lite",
  autoTriggerTokens: 0,
  cacheMinutes: 5,
  preserveSystemPrompt: true,
  preserveSystemPromptMode: "always",
  mcpDescriptionCompressionEnabled: true,
  comboOverrides: {},
  compressionComboId: null,
  stackedPipeline: [
    { engine: "session-dedup" },
    { engine: "lite" },
    { engine: "rtk", intensity: "standard" },
    { engine: "caveman", intensity: "full" },
  ],
  engines: Object.fromEntries(ENGINE_IDS.map((id) => [id, { enabled: false }])),
  activeComboId: null,
  ultraEngine: "heuristic",
  ultraSlmPrewarm: false,
  liveZone: { enabled: false },
  lite: { compressToolResults: true, maxToolLength: 2000 },
  headroom: { enabled: true, minRows: 8 },
  sessionDedup: { enabled: true, minBlockChars: 80, fuzzy: false },
  ccr: { enabled: true, minChars: 600, retrievalRampFactor: 2 },
  codexResponsesConfig: { ...DEFAULT_CODEX_RESPONSES_CONFIG },
  cavemanConfig: { ...DEFAULT_CAVEMAN_CONFIG },
  rtkConfig: { ...DEFAULT_RTK_CONFIG },
  aggressive: { ...DEFAULT_AGGRESSIVE_CONFIG },
  ultra: { ...DEFAULT_ULTRA_CONFIG },
  relevanceConfig: { ...DEFAULT_RELEVANCE_CONFIG },
  omniglyph: { profile: "aggressive" },
};
