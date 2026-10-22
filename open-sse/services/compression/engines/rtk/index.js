// RTK compression engine (4)
// Smart tool-result filtering, dedup & truncation (command-aware)
// Matches https://github.com/cheaper-inference/OmniRoute

import { compressMessages, getRtkSummary } from "../../../../rtk/index.js";
import { createCompressionStats } from "../../stats.js";

const ENGINE_ID = "rtk";

export const rtkEngine = {
  id: ENGINE_ID,
  name: "RTK",
  description: "Command-aware output filtering for terminal, build, test, git, and tool-output.",
  icon: "terminal",
  targets: ["tool_results"],
  stackable: true,
  stackPriority: 10,
  metadata: {
    id: ENGINE_ID,
    name: "RTK",
    description: "Command-aware output filtering.",
    inputScope: "tool-results",
    targetLatencyMs: 1,
    supportsPreview: true,
    stable: true,
  },

  apply(body, options = {}) {
    const stepConfig = options?.stepConfig ?? {};
    if (stepConfig.enabled === false) {
      return { body, compressed: false, stats: null };
    }

    const start = Date.now();
    const clonedBody = structuredClone(body);
    const rtkStats = compressMessages(clonedBody, true);

    if (!rtkStats || !rtkStats.hits || rtkStats.hits.length === 0) {
      return { body, compressed: false, stats: null };
    }

    const summary = getRtkSummary(rtkStats);
    const durationMs = Date.now() - start;
    const stats = createCompressionStats(
      body,
      clonedBody,
      "rtk",
      summary ? summary.filters.map((f) => `rtk:${f}`) : ["rtk"],
      summary?.filters || [],
      durationMs
    );

    return { body: clonedBody, compressed: true, stats };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "enabled", type: "boolean", label: "Enabled", defaultValue: true },
      { key: "intensity", type: "select", label: "Intensity", defaultValue: "standard", options: [{ value: "minimal", label: "minimal" }, { value: "standard", label: "standard" }, { value: "aggressive", label: "aggressive" }] },
    ];
  },

  validateConfig(config = {}) {
    const errors = [];
    if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
      errors.push("enabled must be a boolean");
    }
    return { valid: errors.length === 0, errors };
  },
};
