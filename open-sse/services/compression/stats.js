// Compression statistics & token estimation
// Matches https://github.com/cheaper-inference/OmniRoute

const CHARS_PER_TOKEN = 4;

export function estimateCompressionTokens(payload) {
  if (!payload) return 0;
  if (typeof payload === "string") {
    return Math.ceil(payload.length / CHARS_PER_TOKEN);
  }
  try {
    const serialized = JSON.stringify(payload);
    return Math.ceil(serialized.length / CHARS_PER_TOKEN);
  } catch {
    return 0;
  }
}

export function createCompressionStats(
  originalBody,
  compressedBody,
  mode = "stacked",
  techniquesUsed = [],
  rulesApplied = [],
  durationMs = 0
) {
  const originalTokens = estimateCompressionTokens(originalBody);
  const compressedTokens = estimateCompressionTokens(compressedBody);
  const savingsPercent =
    originalTokens > 0
      ? Math.max(0, Math.round(((originalTokens - compressedTokens) / originalTokens) * 1000) / 10)
      : 0;

  return {
    originalTokens,
    compressedTokens,
    savingsPercent,
    mode,
    techniquesUsed: Array.from(new Set(techniquesUsed)),
    rulesApplied: Array.from(new Set(rulesApplied)),
    durationMs,
    timestamp: Date.now(),
  };
}
