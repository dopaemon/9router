import { describe, it, expect } from "vitest";
import { compressMessages, getRtkSummary } from "../../open-sse/rtk/index.js";

describe("RTK Gemini / Antigravity format support", () => {
  it("compresses tool results in Gemini contents[].parts[].functionResponse.response", () => {
    const fakeDiff = "diff --git a/test.js b/test.js\n--- a/test.js\n+++ b/test.js\n@@ -1,5 +1,5 @@\n" + "+added line\n".repeat(150);
    const body = {
      contents: [
        {
          role: "user",
          parts: [
            {
              functionResponse: {
                name: "bash",
                response: {
                  result: fakeDiff
                }
              }
            }
          ]
        }
      ]
    };

    const stats = compressMessages(body, true);
    expect(stats).toBeTruthy();
    expect(stats.hits.length).toBe(1);
    expect(stats.hits[0].filter).toBe("git-diff");
    expect(stats.bytesBefore - stats.bytesAfter).toBeGreaterThan(0);
    const summary = getRtkSummary(stats);
    expect(summary.applied).toBe(true);
    expect(summary.tokensSavedEst).toBeGreaterThan(0);
  });

  it("compresses tool results in Antigravity request.contents", () => {
    const fakeLog = "commit 1234567890123456789012345678901234567890\nAuthor: test <test@example.com>\n\n" + "    commit message\n".repeat(50);
    const body = {
      request: {
        contents: [
          {
            role: "user",
            parts: [
              {
                functionResponse: {
                  name: "bash",
                  response: {
                    output: fakeLog
                  }
                }
              }
            ]
          }
        ]
      }
    };

    const stats = compressMessages(body, true);
    expect(stats).toBeTruthy();
    expect(stats.hits.length).toBe(1);
    expect(stats.hits[0].filter).toBe("git-log");
  });
});
