// Compression Strategy Selector & Pipeline Execution
// Matches https://github.com/cheaper-inference/OmniRoute

import { registerBuiltinCompressionEngines } from "./engines/index.js";
import { getCompressionEngine, listEnabledEngines } from "./engines/registry.js";
import { createCompressionStats } from "./stats.js";

// Ensure engines are loaded
registerBuiltinCompressionEngines();

export async function applyCompressionAsync(body, mode = "off", options = {}) {
  if (!body || mode === "off") {
    return { body, compressed: false, stats: null };
  }

  // Handle single engine modes
  const modeEngineMap = {
    lite: "lite",
    standard: "caveman",
    caveman: "caveman",
    aggressive: "aggressive",
    ultra: "ultra",
    rtk: "rtk",
    "codex-responses": "codex-responses",
    omniglyph: "omniglyph",
    headroom: "headroom",
    "session-dedup": "session-dedup",
    ccr: "ccr",
    relevance: "relevance",
    llmlingua: "llmlingua",
  };

  if (mode !== "stacked" && modeEngineMap[mode]) {
    const engineId = modeEngineMap[mode];
    const engine = getCompressionEngine(engineId);
    if (!engine) return { body, compressed: false, stats: null };

    if (typeof engine.applyAsync === "function") {
      return await engine.applyAsync(body, options);
    }
    return engine.apply(body, options);
  }

  // Stacked mode: execute pipeline
  return await applyStackedPipelineAsync(body, options);
}

export function applyCompression(body, mode = "off", options = {}) {
  if (!body || mode === "off") {
    return { body, compressed: false, stats: null };
  }

  const modeEngineMap = {
    lite: "lite",
    standard: "caveman",
    caveman: "caveman",
    aggressive: "aggressive",
    ultra: "ultra",
    rtk: "rtk",
    "codex-responses": "codex-responses",
    omniglyph: "omniglyph",
    headroom: "headroom",
    "session-dedup": "session-dedup",
    ccr: "ccr",
    relevance: "relevance",
  };

  if (mode !== "stacked" && modeEngineMap[mode]) {
    const engine = getCompressionEngine(modeEngineMap[mode]);
    return engine ? engine.apply(body, options) : { body, compressed: false, stats: null };
  }

  // Stacked synchronous pass
  return applyStackedPipeline(body, options);
}

export async function applyStackedPipelineAsync(body, options = {}) {
  const steps = options?.stackedPipeline || options?.config?.stackedPipeline || [
    { engine: "session-dedup" },
    { engine: "lite" },
    { engine: "rtk", intensity: "standard" },
    { engine: "caveman", intensity: "full" },
  ];

  let currentBody = body;
  let anyCompressed = false;
  const techniques = [];
  const rules = [];
  const start = Date.now();

  for (const step of steps) {
    const engineId = typeof step === "string" ? step : step.engine;
    const engine = getCompressionEngine(engineId);
    if (!engine) continue;

    const stepOptions = {
      ...options,
      stepConfig: typeof step === "object" ? (step.config || step) : {},
    };

    let result;
    try {
      if (typeof engine.applyAsync === "function") {
        result = await engine.applyAsync(currentBody, stepOptions);
      } else {
        result = engine.apply(currentBody, stepOptions);
      }
    } catch {
      // Fail-open for step
      continue;
    }

    if (result && result.compressed && result.body) {
      currentBody = result.body;
      anyCompressed = true;
      if (result.stats?.techniquesUsed) techniques.push(...result.stats.techniquesUsed);
      if (result.stats?.rulesApplied) rules.push(...result.stats.rulesApplied);
    }
  }

  if (!anyCompressed) {
    return { body, compressed: false, stats: null };
  }

  const durationMs = Date.now() - start;
  const stats = createCompressionStats(body, currentBody, "stacked", techniques, rules, durationMs);
  return { body: currentBody, compressed: true, stats };
}

export function applyStackedPipeline(body, options = {}) {
  const steps = options?.stackedPipeline || options?.config?.stackedPipeline || [
    { engine: "session-dedup" },
    { engine: "lite" },
    { engine: "rtk", intensity: "standard" },
    { engine: "caveman", intensity: "full" },
  ];

  let currentBody = body;
  let anyCompressed = false;
  const techniques = [];
  const rules = [];
  const start = Date.now();

  for (const step of steps) {
    const engineId = typeof step === "string" ? step : step.engine;
    const engine = getCompressionEngine(engineId);
    if (!engine) continue;

    const stepOptions = {
      ...options,
      stepConfig: typeof step === "object" ? (step.config || step) : {},
    };

    let result;
    try {
      result = engine.apply(currentBody, stepOptions);
    } catch {
      continue;
    }

    if (result && result.compressed && result.body) {
      currentBody = result.body;
      anyCompressed = true;
      if (result.stats?.techniquesUsed) techniques.push(...result.stats.techniquesUsed);
      if (result.stats?.rulesApplied) rules.push(...result.stats.rulesApplied);
    }
  }

  if (!anyCompressed) {
    return { body, compressed: false, stats: null };
  }

  const durationMs = Date.now() - start;
  const stats = createCompressionStats(body, currentBody, "stacked", techniques, rules, durationMs);
  return { body: currentBody, compressed: true, stats };
}
