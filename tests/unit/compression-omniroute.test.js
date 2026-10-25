import { describe, it, expect } from "vitest";

import { sessionDedupEngine } from "../../open-sse/services/compression/engines/session-dedup/index.js";
import { ccrEngine, handleCcrRetrieve, shouldSkipCcr } from "../../open-sse/services/compression/engines/ccr/index.js";
import { liteEngine, collapseWhitespace, dedupSystemPrompt, compressToolResults, replaceImageUrls } from "../../open-sse/services/compression/engines/lite/index.js";
import { rtkEngine } from "../../open-sse/services/compression/engines/rtk/index.js";
import { codexResponsesEngine } from "../../open-sse/services/compression/engines/codexResponses/index.js";
import { headroomEngine, encodeTabular, tryCompactJson } from "../../open-sse/services/compression/engines/headroom/index.js";
import { relevanceEngine } from "../../open-sse/services/compression/engines/relevance/index.js";
import { cavemanEngine, compressProse } from "../../open-sse/services/compression/engines/caveman/index.js";
import { aggressiveEngine, applyAging } from "../../open-sse/services/compression/engines/aggressive/index.js";
import { llmlinguaEngine, compressProseSemantic } from "../../open-sse/services/compression/engines/llmlingua/index.js";
import { ultraEngine, pruneByScore } from "../../open-sse/services/compression/engines/ultra/index.js";
import { omniglyphEngine } from "../../open-sse/services/compression/engines/omniglyph/index.js";
import { applyCompression, applyCompressionAsync, applyStackedPipeline } from "../../open-sse/services/compression/strategySelector.js";
import { ENGINE_CATALOG, ENGINE_IDS, isSafeDefault } from "../../open-sse/services/compression/engineCatalog.js";

describe("OmniRoute 12 Compression Engines — In-Depth Audit", () => {
  it("catalog contains all 12 engines with correct priorities and safety flags", () => {
    expect(ENGINE_IDS).toHaveLength(12);
    expect(ENGINE_IDS).toEqual([
      "session-dedup",
      "ccr",
      "lite",
      "rtk",
      "codex-responses",
      "headroom",
      "relevance",
      "caveman",
      "aggressive",
      "llmlingua",
      "ultra",
      "omniglyph",
    ]);

    // Lossless / safe default verification
    expect(isSafeDefault("session-dedup")).toBe(true);
    expect(isSafeDefault("ccr")).toBe(true);
    expect(isSafeDefault("lite")).toBe(true);
    expect(isSafeDefault("headroom")).toBe(true);
    expect(isSafeDefault("rtk")).toBe(false);
    expect(isSafeDefault("caveman")).toBe(false);
  });

  describe("1. Session-Dedup", () => {
    const block = "line 1: compilation finished\nline 2: 42 test suites passed successfully\nline 3: artifacts packaged into dist\n";

    it("deduplicates repeated multi-line blocks across turns", () => {
      const body = {
        messages: [
          { role: "user", content: "turn 1: " + block },
          { role: "assistant", content: "ack 1" },
          { role: "user", content: "turn 2: " + block },
          { role: "assistant", content: "ack 2" },
        ],
      };

      const result = sessionDedupEngine.apply(body);
      expect(result.compressed).toBe(true);
      expect(result.body.messages[0].content).toContain(block);
      expect(result.body.messages[2].content).toContain("[dedup:ref sha=");
    });

    it("never rewrites system messages or the current turn (messages after last assistant)", () => {
      const body = {
        messages: [
          { role: "system", content: block },
          { role: "user", content: "turn 1: " + block },
          { role: "assistant", content: "ack 1" },
          { role: "user", content: "current turn (must be preserved): " + block },
        ],
      };

      const result = sessionDedupEngine.apply(body);
      expect(result.body.messages[0].content).toBe(block); // system preserved
      expect(result.body.messages[3].content).toContain(block); // current turn preserved
    });

    it("handles multipart tool_result blocks without mutating structure", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [{ type: "tool_result", content: block }],
          },
          { role: "assistant", content: "ack" },
          {
            role: "user",
            content: [{ type: "tool_result", content: block }],
          },
          { role: "assistant", content: "done" },
        ],
      };

      const result = sessionDedupEngine.apply(body);
      expect(result.compressed).toBe(true);
      expect(result.body.messages[2].content[0].content).toContain("[dedup:ref sha=");
    });
  });

  describe("2. CCR (Content-Compression-Retrieve)", () => {
    it("archives large blocks and isolates by principalId", () => {
      const largeContent = "Important database schema dump and documentation.\n".repeat(25);
      const body = {
        messages: [
          { role: "user", content: largeContent },
          { role: "assistant", content: "ready" },
        ],
      };

      const result = ccrEngine.apply(body, { principalId: "tenant-A" });
      expect(result.compressed).toBe(true);
      const match = result.body.messages[0].content.match(/\[CCR retrieve hash=([a-f0-9]+) chars=\d+\]/);
      expect(match).not.toBeNull();
      const hash = match[1];

      // Retrieve by tenant-A succeeds
      expect(handleCcrRetrieve(hash, "tenant-A")).toBe(largeContent);
      // Retrieve by tenant-B fails (IDOR protection)
      expect(handleCcrRetrieve(hash, "tenant-B")).toBeNull();
    });

    it("stops compressing after block exceeds retrieval threshold (threshold=3)", () => {
      const largeText = "Frequently accessed specification document block.\n".repeat(20);
      const body = {
        messages: [
          { role: "user", content: largeText },
          { role: "assistant", content: "noted" },
        ],
      };

      const res = ccrEngine.apply(body, { principalId: "thresh-user" });
      const match = res.body.messages[0].content.match(/\[CCR retrieve hash=([a-f0-9]+)/);
      const hash = match[1];

      // Retrieve 3 times to hit threshold
      handleCcrRetrieve(hash, "thresh-user");
      handleCcrRetrieve(hash, "thresh-user");
      handleCcrRetrieve(hash, "thresh-user");

      expect(shouldSkipCcr(hash, "thresh-user")).toBe(true);
    });
  });

  describe("3. Lite", () => {
    it("collapses whitespace and normalizes blank lines", () => {
      const body = {
        messages: [
          { role: "user", content: "para 1\n\n\n\n\npara 2   \n\n\npara 3" },
        ],
      };
      const res = liteEngine.apply(body);
      expect(res.compressed).toBe(true);
      expect(res.body.messages[0].content).toBe("para 1\n\npara 2\n\npara 3");
    });

    it("deduplicates identical system prompts", () => {
      const body = {
        messages: [
          { role: "system", content: "You are a helpful assistant." },
          { role: "system", content: "You are a helpful assistant." },
          { role: "user", content: "hi" },
        ],
      };
      const res = liteEngine.apply(body, { config: { preserveSystemPrompt: false } });
      expect(res.compressed).toBe(true);
      expect(res.body.messages.filter((m) => m.role === "system")).toHaveLength(1);
    });

    it("replaces base64 image data URIs when vision is unsupported", () => {
      const body = {
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "see image" },
              { type: "image_url", image_url: { url: "data:image/png;base64,iVBORw0KGgo..." } },
            ],
          },
        ],
      };
      const res = liteEngine.apply(body, { supportsVision: false });
      expect(res.compressed).toBe(true);
      expect(res.body.messages[0].content[1].text).toBe("[image: png]");
    });
  });

  describe("4. RTK", () => {
    it("filters git and command outputs while preserving status", () => {
    const gitStatusOutput = [
      "On branch main",
      "Changes not staged for commit:",
      "  (use \"git add <file>...\" to update what will be committed)",
      "  (use \"git restore <file>...\" to discard changes in working directory)",
      ...Array.from({ length: 25 }, (_, i) => `\tmodified:   src/components/module_${i}/index.js`),
      "Untracked files:",
      "  (use \"git add <file>...\" to include in what will be committed)",
      ...Array.from({ length: 25 }, (_, i) => `\ttests/unit/temp_${i}.test.js`),
    ].join("\n");
      const body = {
        messages: [
          {
            role: "tool",
            content: gitStatusOutput,
          },
        ],
      };
      const res = rtkEngine.apply(body);
      expect(res.compressed).toBe(true);
      expect(res.stats.mode).toBe("rtk");
    });
  });

  describe("5. Responses Tool Output (codex-responses)", () => {
    it("minifies nested JSON in function_call_output", () => {
      const prettyJson = JSON.stringify({ key: "value", list: [1, 2, 3] }, null, 4);
      const body = {
        input: [
          { type: "function_call_output", output: prettyJson },
        ],
      };
      const res = codexResponsesEngine.apply(body, { stepConfig: { minBytes: 10 } });
      expect(res.compressed).toBe(true);
      expect(res.body.input[0].output).toBe(JSON.stringify({ key: "value", list: [1, 2, 3] }));
    });

    it("compacts diff hunks by stripping redundant unchanged lines", () => {
      const diff = "@@ -1,10 +1,10 @@\n context 1\n context 2\n context 3\n context 4\n-old line\n+new line\n context 5\n context 6\n context 7\n";
      const body = {
        input: [
          { type: "function_call_output", output: diff },
        ],
      };
      const res = codexResponsesEngine.apply(body, { stepConfig: { minBytes: 10 } });
      expect(res.compressed).toBe(true);
      expect(res.body.input[0].output).toContain("+new line");
    });
  });

  describe("6. Headroom SmartCrusher", () => {
    it("encodes homogeneous arrays to omni-tabular format", () => {
      const records = Array.from({ length: 12 }, (_, i) => ({ id: i, name: `user_${i}`, role: "member" }));
      const body = {
        messages: [
          { role: "user", content: JSON.stringify(records) },
        ],
      };
      const res = headroomEngine.apply(body, { stepConfig: { minRows: 5 } });
      expect(res.compressed).toBe(true);
      expect(res.body.messages[0].content).toContain("```omni-tabular");
      expect(res.body.messages[0].content).toContain("[12 rows]");
    });

    it("skips arrays below the minRows threshold", () => {
      const small = [{ id: 1 }, { id: 2 }];
      const body = {
        messages: [
          { role: "user", content: JSON.stringify(small) },
        ],
      };
      const res = headroomEngine.apply(body, { stepConfig: { minRows: 8 } });
      expect(res.compressed).toBe(false);
    });
  });

  describe("7. Relevance", () => {
    it("retains relevant sentences and force-preserves errors and URLs", () => {
      const content = [
        "Cats like to nap in the afternoon sun.",
        "Error: Connection timeout at https://api.example.com/v1.",
        "The sky in Madrid is blue.",
        "Postgres port is 5432.",
      ].join(" ");

      const body = {
        messages: [
          { role: "user", content: content },
          { role: "assistant", content: "ok" },
          { role: "user", content: "What is the postgres connection error?" },
        ],
      };

      const res = relevanceEngine.apply(body, { stepConfig: { budgetPercent: 0.6 } });
      expect(res.compressed).toBe(true);
      // Sentences with Error: and URL are force-preserved
      expect(res.body.messages[0].content).toContain("Error: Connection timeout");
      expect(res.body.messages[0].content).toContain("5432");
    });
  });

  describe("8. Caveman", () => {
    it("removes filler words and polite phrases while keeping code blocks intact", () => {
      const prompt = "Could you please help me in order to write: ```const x = 10;``` Thank you so much!";
      const body = {
        messages: [{ role: "user", content: prompt }],
      };
      const res = cavemanEngine.apply(body);
      expect(res.compressed).toBe(true);
      expect(res.body.messages[0].content).toContain("const x = 10;");
      expect(res.body.messages[0].content).not.toContain("Could you please");
      expect(res.body.messages[0].content).not.toContain("Thank you so much");
    });
  });

  describe("9. Aggressive", () => {
    it("preserves recent turns verbatim and compresses/summarizes older turns", () => {
      const oldTurn = "Old turn explanation with extensive details.\n".repeat(15);
      const recentTurn = "Recent turn that must stay intact.";
      const body = {
        messages: [
          { role: "user", content: oldTurn },
          { role: "assistant", content: oldTurn },
          { role: "user", content: recentTurn },
          { role: "assistant", content: recentTurn },
          { role: "user", content: "Current question" },
        ],
      };
      const res = aggressiveEngine.apply(body, { stepConfig: { thresholds: { verbatim: 2, moderate: 3 } } });
      expect(res.compressed).toBe(true);
      expect(res.body.messages[0].content).toContain("[... ");
      expect(res.body.messages[2].content).toBe(recentTurn); // recent turn verbatim
    });
  });

  describe("10. LLMLingua-2", () => {
    it("fails open gracefully and returns original content on error", async () => {
      const body = {
        messages: [{ role: "user", content: "Important system instruction with code ```ls -la```" }],
      };
      const res = await llmlinguaEngine.applyAsync(body);
      expect(res.body).toBeDefined();
      expect(res.body.messages[0].content).toContain("```ls -la```");
    });
  });

  describe("11. Ultra", () => {
    it("protects critical polarity/negation words and inline code from pruning", () => {
      const text = "You must never delete the production database. The command is `DROP TABLE users;`.";
      const body = {
        messages: [{ role: "user", content: text }],
      };
      const res = ultraEngine.apply(body);
      expect(res.compressed).toBe(true);
      // Inviolable polarity words (#13454)
      expect(res.body.messages[0].content).toContain("must");
      expect(res.body.messages[0].content).toContain("never");
      expect(res.body.messages[0].content).toContain("`DROP TABLE users;`");
    });
  });

  describe("12. OmniGlyph", () => {
    it("skips when vision is disabled or profile is passthrough", () => {
      const body = {
        model: "claude-3-7-sonnet",
        messages: [{ role: "user", content: "Describe image" }],
      };
      const resNoVision = omniglyphEngine.apply(body, { supportsVision: false });
      expect(resNoVision.compressed).toBe(false);
      expect(resNoVision.stats.techniquesUsed).toContain("skip:no_vision");

      const resPass = omniglyphEngine.apply(body, { stepConfig: { profile: "passthrough" }, supportsVision: true });
      expect(resPass.compressed).toBe(false);
      expect(resPass.stats.techniquesUsed).toContain("skip:profile_passthrough");
    });
  });

  describe("Pipeline & API Routes", () => {
    it("stacked pipeline executes in deterministic sequence", async () => {
      const block = "error log entry 1\nerror log entry 2\nerror log entry 3\n";
      const body = {
        messages: [
          { role: "user", content: "Could you please review: " + block },
          { role: "assistant", content: "done" },
          { role: "user", content: "Could you please review: " + block },
          { role: "assistant", content: "acknowledged" },
        ],
      };

      const result = await applyCompressionAsync(body, "stacked", {
        stackedPipeline: [
          { engine: "session-dedup" },
          { engine: "lite" },
          { engine: "caveman" },
        ],
      });

      expect(result.compressed).toBe(true);
      expect(result.stats.savingsPercent).toBeGreaterThan(0);
    });

    it("GET /api/compression/engines returns all 12 registered engines", async () => {
      const { GET } = await import("@/app/api/compression/engines/route.js");
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.count).toBe(12);
      expect(json.engines).toHaveLength(12);
    });

    it("POST /api/compression/preview previews compression on sample text", async () => {
      const { POST } = await import("@/app/api/compression/preview/route.js");
      const req = new Request("http://localhost/api/compression/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "caveman",
          text: "Could you please tell me in order to do this: ```code``` Thank you so much!",
        }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.compressed).toBe(true);
      expect(json.body.messages[0].content).toContain("code");
    });

    it("POST /api/compression/retrieve retrieves stored CCR blocks", async () => {
      const { POST } = await import("@/app/api/compression/retrieve/route.js");
      const { storeCcrBlock } = await import("open-sse/services/compression/engines/ccr/index.js");

      const stored = storeCcrBlock("Retrievable text block payload");
      expect(stored).not.toBeNull();

      const req = new Request("http://localhost/api/compression/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hash: stored.hash }),
      });
      const res = await POST(req);
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.content).toBe("Retrievable text block payload");
    });
  });
});
