import { describe, it, expect } from "vitest";
import { getRtkSummary } from "@/../open-sse/rtk/index.js";

describe("RTK Token Gain Tracking", () => {
  it("calculates tokensSavedEst and savedPct from rtkStats", () => {
    const stats = {
      bytesBefore: 10000,
      bytesAfter: 6000,
      hits: [
        { shape: "openai-tool", filter: "git_diff", saved: 2500 },
        { shape: "openai-tool", filter: "cargo_check", saved: 1500 },
      ],
    };

    const summary = getRtkSummary(stats);
    expect(summary).not.toBeNull();
    expect(summary.applied).toBe(true);
    expect(summary.bytesSaved).toBe(4000);
    // 4000 / 4 = 1000 tokens
    expect(summary.tokensSavedEst).toBe(1000);
    expect(summary.savedPct).toBe(40.0);
    expect(summary.hits).toBe(2);
    expect(summary.filters).toEqual(["git_diff", "cargo_check"]);
  });

  it("returns null if no hits or no bytes saved", () => {
    expect(getRtkSummary(null)).toBeNull();
    expect(getRtkSummary({ bytesBefore: 100, bytesAfter: 100, hits: [] })).toBeNull();
    expect(getRtkSummary({ bytesBefore: 100, bytesAfter: 150, hits: [{ saved: -50 }] })).toBeNull();
  });
});
