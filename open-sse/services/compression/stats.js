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
  const tokensSaved = Math.max(0, originalTokens - compressedTokens);
  const bytesBefore = Math.round(originalTokens * CHARS_PER_TOKEN);
  const bytesAfter = Math.round(compressedTokens * CHARS_PER_TOKEN);
  const bytesSaved = Math.max(0, bytesBefore - bytesAfter);
  const savingsPercent =
    originalTokens > 0
      ? Math.max(0, Math.round(((originalTokens - compressedTokens) / originalTokens) * 1000) / 10)
      : 0;

  return {
    originalTokens,
    compressedTokens,
    tokensSaved,
    tokensSavedEst: tokensSaved,
    bytesBefore,
    bytesAfter,
    bytesSaved,
    savingsPercent,
    savedPct: savingsPercent,
    mode,
    techniquesUsed: Array.from(new Set(techniquesUsed.filter(Boolean))),
    rulesApplied: Array.from(new Set(rulesApplied.filter(Boolean))),
    durationMs,
    timestamp: Date.now(),
  };
}

/**
 * Merge OmniRoute 12-tier compression statistics into the unified RTK summary object
 * so that all saved token metrics flow directly into usage counters, charts, and request details.
 *
 * @param {Object|null} compressionStats OmniRoute compression result stats
 * @param {Object|null} baseRtkSummary Tool result RTK filter summary
 * @param {Array} [outputDirectives] Active output directives (caveman, ponytail)
 * @returns {Object|null} Unified RTK usage summary
 */
export function formatOmnirouteRtkSummary(compressionStats, baseRtkSummary = null, outputDirectives = []) {
  if (!compressionStats && !baseRtkSummary && (!outputDirectives || outputDirectives.length === 0)) {
    return null;
  }

  const compTokensSaved = Math.max(
    0,
    compressionStats?.tokensSaved ??
    compressionStats?.tokensSavedEst ??
    (((compressionStats?.originalTokens || 0) - (compressionStats?.compressedTokens || 0)))
  );

  const compBytesBefore = compressionStats?.bytesBefore || ((compressionStats?.originalTokens || 0) * CHARS_PER_TOKEN);
  const compBytesAfter = compressionStats?.bytesAfter || ((compressionStats?.compressedTokens || 0) * CHARS_PER_TOKEN);
  const compBytesSaved = Math.max(0, compressionStats?.bytesSaved || (compBytesBefore - compBytesAfter));

  if (!baseRtkSummary) {
    if (compBytesSaved <= 0 && compTokensSaved <= 0 && (!outputDirectives || outputDirectives.length === 0)) {
      return null;
    }
    return {
      applied: compBytesSaved > 0 || compTokensSaved > 0,
      bytesBefore: compBytesBefore,
      bytesAfter: compBytesAfter,
      bytesSaved: compBytesSaved,
      tokensSavedEst: compTokensSaved,
      savedPct: compressionStats?.savingsPercent ?? (compBytesBefore > 0 ? +((compBytesSaved / compBytesBefore) * 100).toFixed(1) : 0),
      hits: (compressionStats?.techniquesUsed || []).length || (outputDirectives?.length ? 0 : 1),
      filters: compressionStats?.techniquesUsed?.length ? compressionStats.techniquesUsed : (compressionStats ? [compressionStats.mode || "omniroute"] : []),
      techniques: compressionStats?.techniquesUsed || [],
      rules: compressionStats?.rulesApplied || [],
      omniroute: compressionStats || undefined,
      outputDirectives: outputDirectives?.length ? outputDirectives : undefined,
    };
  }

  const totalTokensSaved = (baseRtkSummary.tokensSavedEst || 0) + compTokensSaved;
  const totalBytesBefore = Math.max(baseRtkSummary.bytesBefore || 0, compBytesBefore);
  const totalBytesSaved = (baseRtkSummary.bytesSaved || 0) + compBytesSaved;
  const totalBytesAfter = Math.max(0, totalBytesBefore - totalBytesSaved);
  const savedPct = totalBytesBefore > 0 ? +((totalBytesSaved / totalBytesBefore) * 100).toFixed(1) : 0;

  const mergedFilters = Array.from(new Set([
    ...(baseRtkSummary.filters || []),
    ...(compressionStats?.techniquesUsed || []),
  ]));

  return {
    applied: true,
    bytesBefore: totalBytesBefore,
    bytesAfter: totalBytesAfter,
    bytesSaved: totalBytesSaved,
    tokensSavedEst: totalTokensSaved,
    savedPct,
    hits: (baseRtkSummary.hits || 0) + (compressionStats?.techniquesUsed?.length || 1),
    filters: mergedFilters,
    techniques: compressionStats?.techniquesUsed || [],
    rules: compressionStats?.rulesApplied || [],
    omniroute: compressionStats || undefined,
    outputDirectives: outputDirectives?.length ? outputDirectives : (baseRtkSummary.outputDirectives || undefined),
  };
}
