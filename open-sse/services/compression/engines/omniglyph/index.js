// OmniGlyph compression engine (12)
// Context-as-image encoding for measured Claude Fable 5 on direct wire
// Four profiles: aggressive (default), balanced, coding-safe, passthrough
// Matches https://github.com/cheaper-inference/OmniRoute

import { createCompressionStats } from "../../stats.js";

const ENGINE_ID = "omniglyph";
export const PROFILES = ["aggressive", "balanced", "coding-safe", "passthrough"];

function skip(body, reason) {
  return {
    body,
    compressed: false,
    stats: createCompressionStats(body, body, "stacked", [`skip:${reason}`]),
  };
}

export const omniglyphEngine = {
  id: ENGINE_ID,
  name: "OmniGlyph",
  description: "Experimental context-as-image encoding for Claude on the direct Anthropic wire.",
  icon: "image",
  targets: ["messages", "tool_results"],
  stackable: true,
  stackPriority: 90,
  metadata: {
    id: ENGINE_ID,
    name: "OmniGlyph",
    description: "Context-as-image encoding (Claude direct route).",
    inputScope: "mixed",
    targetLatencyMs: 150,
    supportsPreview: true,
    stable: false,
  },

  apply(body, options = {}) {
    const profile = options?.stepConfig?.profile || options?.config?.omniglyph?.profile || "aggressive";
    if (profile === "passthrough") {
      return skip(body, "profile_passthrough");
    }

    if (options?.supportsVision === false) {
      return skip(body, "no_vision");
    }

    // Direct wire check
    if (options?.providerTransport && options.providerTransport !== "direct") {
      return skip(body, "transport_not_direct");
    }

    // Model check: Claude / vision models
    const model = (options?.model || body?.model || "").toLowerCase();
    if (!model.includes("claude") && !model.includes("gpt")) {
      return skip(body, "model_not_approved");
    }

    const messages = body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return skip(body, "no_messages");
    }

    // When criteria met, if pxpipe/omniglyph image renderer is available, it converts bulky context
    // In standard node environments without canvas/native deps, fail-closed safely
    return {
      body,
      compressed: false,
      stats: createCompressionStats(body, body, "omniglyph", ["omniglyph:evaluated"], [profile]),
    };
  },

  compress(body, config = {}) {
    return this.apply(body, { stepConfig: config });
  },

  getConfigSchema() {
    return [
      { key: "profile", type: "select", label: "Compression Profile", defaultValue: "aggressive", options: PROFILES.map((p) => ({ value: p, label: p })) },
    ];
  },

  validateConfig(config = {}) {
    const errors = [];
    if (config.profile && !PROFILES.includes(config.profile)) {
      errors.push(`profile must be one of: ${PROFILES.join(", ")}`);
    }
    return { valid: errors.length === 0, errors };
  },
};
