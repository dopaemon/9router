import { describe, it, expect } from "vitest";
import { formatOmnirouteRtkSummary, createCompressionStats } from "../../open-sse/services/compression/stats.js";
import { enrichRtkWithOutputSavings } from "../../open-sse/handlers/chatCore/requestDetail.js";
describe("OmniRoute Compression to Usage/RTK Integration", () => {
  it("formats standalone OmniRoute compression stats into valid RTK summary for usage tracking", () => {
    const originalBody = {
      messages: [
        { role: "user", content: "Please kindly help me to write some code thank you very much indeed!" },
      ],
    };
    const compressedBody = {
      messages: [
        { role: "user", content: "write code" },
      ],
    };

    const stats = createCompressionStats(
      originalBody,
      compressedBody,
      "stacked",
      ["caveman", "lite"],
      ["pleasantries"]
    );

    expect(stats.tokensSaved).toBeGreaterThan(0);
    expect(stats.bytesSaved).toBeGreaterThan(0);

    const rtkSummary = formatOmnirouteRtkSummary(stats, null);
    expect(rtkSummary).not.toBeNull();
    expect(rtkSummary.applied).toBe(true);
    expect(rtkSummary.tokensSavedEst).toBe(stats.tokensSaved);
    expect(rtkSummary.bytesSaved).toBe(stats.bytesSaved);
    expect(rtkSummary.bytesBefore).toBe(stats.bytesBefore);
    expect(rtkSummary.bytesAfter).toBe(stats.bytesAfter);
    expect(rtkSummary.savedPct).toBe(stats.savingsPercent);
    expect(rtkSummary.filters).toEqual(["caveman", "lite"]);
    expect(rtkSummary.omniroute).toBe(stats);
  });

  it("merges OmniRoute compression with existing tool-result RTK summary cleanly", () => {
    const baseRtk = {
      applied: true,
      bytesBefore: 1200,
      bytesAfter: 400,
      bytesSaved: 800,
      tokensSavedEst: 200,
      savedPct: 66.7,
      hits: 2,
      filters: ["git_diff"],
    };

    const compStats = {
      originalTokens: 1000,
      compressedTokens: 700,
      tokensSaved: 300,
      tokensSavedEst: 300,
      bytesBefore: 4000,
      bytesAfter: 2800,
      bytesSaved: 1200,
      savingsPercent: 30.0,
      mode: "stacked",
      techniquesUsed: ["session-dedup", "caveman"],
      rulesApplied: ["filler_adverbs"],
    };

    const merged = formatOmnirouteRtkSummary(compStats, baseRtk);
    expect(merged.applied).toBe(true);
    expect(merged.tokensSavedEst).toBe(500); // 200 + 300
    expect(merged.bytesSaved).toBe(2000); // 800 + 1200
    expect(merged.filters).toContain("git_diff");
    expect(merged.filters).toContain("session-dedup");
    expect(merged.filters).toContain("caveman");
  });

  it("returns null when no compression was applied and no base RTK exists", () => {
    expect(formatOmnirouteRtkSummary(null, null)).toBeNull();
    const zeroStats = {
      originalTokens: 100,
      compressedTokens: 100,
      tokensSaved: 0,
      bytesSaved: 0,
    };
    expect(formatOmnirouteRtkSummary(zeroStats, null)).toBeNull();
  });
  it("enriches RTK with output tokens saved from Caveman output mode", () => {
    const rtk = {
      applied: true,
      inputTokensSavedEst: 200,
      tokensSavedEst: 200,
      bytesBefore: 1000,
      bytesAfter: 200,
      bytesSaved: 800,
      hits: 1,
      filters: ["lite"],
      outputDirectives: [{ type: "caveman", level: "full" }],
    };

    // 100 completion tokens returned by model with full caveman (65% reduction)
    // uncompressed = 100 / (1 - 0.65) = 286 tokens -> saved = 186 tokens
    const enriched = enrichRtkWithOutputSavings(rtk, 100);
    expect(enriched.applied).toBe(true);
    expect(enriched.outputTokensSavedEst).toBe(186);
    expect(enriched.inputTokensSavedEst).toBe(200);
    expect(enriched.tokensSavedEst).toBe(386); // 200 input + 186 output
    expect(enriched.filters).toContain("lite");
    expect(enriched.filters).toContain("caveman:full");
  });

  it("enriches RTK with output tokens saved from Ponytail", () => {
    const rtk = {
      applied: false,
      outputDirectives: [{ type: "ponytail", level: "ultra" }],
    };

    // 100 completion tokens with ultra ponytail (60% reduction)
    // saved = 100 * (0.60 / 0.40) = 150 tokens
    const enriched = enrichRtkWithOutputSavings(rtk, 100);
    expect(enriched.applied).toBe(true);
    expect(enriched.outputTokensSavedEst).toBe(150);
    expect(enriched.tokensSavedEst).toBe(150);
    expect(enriched.filters).toContain("ponytail:ultra");
  });
});
