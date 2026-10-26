import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { ANTIGRAVITY_PROMPT_REWRITES } from "../../open-sse/config/appConstants.js";
import { ANTIGRAVITY_IDE_VERSION } from "../../open-sse/providers/shared.js";

describe("Antigravity Antiban protections", () => {
  const ag = new AntigravityExecutor();

  it("strips client metadata to avoid Google 400 INVALID_ARGUMENT", () => {
    const out = ag.transformRequest("gemini-3.8-flash-tiered", {
      metadata: { ideName: "antigravity", ideVersion: "2.26.0", user_id: "test" },
      request: {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      },
    }, true, { projectId: "test-proj", connectionId: "conn-1" });

    expect(out.metadata).toBeUndefined();
    expect(out.userAgent).toBe("antigravity");
  });

  it("sanitizes competitor IDE branding in systemInstruction", () => {
    const systemPrompts = [
      "You are Cursor, an intelligent coding assistant created by Anysphere.",
      "You are Roo Code, a highly skilled software engineer.",
      "You are Cline, a software developer.",
      "You are Cascade, a collaborative AI assistant.",
      "You are an expert software developer assisting via Aider.",
      "<anthropic_thinking_protocol>think carefully</anthropic_thinking_protocol>",
    ];

    for (const prompt of systemPrompts) {
      const out = ag.transformRequest("gemini-3.8-flash-tiered", {
        request: {
          systemInstruction: { parts: [{ text: prompt }] },
          contents: [{ role: "user", parts: [{ text: "Hello" }] }],
        },
      }, true, { projectId: "test-proj" });

      const text = out.request.systemInstruction.parts[0].text;
      expect(text).not.toContain("Cursor");
      expect(text).not.toContain("Anysphere");
      expect(text).not.toContain("Roo Code");
      expect(text).not.toContain("Cline");
      expect(text).not.toContain("Cascade");
      expect(text).not.toContain("Aider");
      expect(text).not.toContain("<anthropic_thinking_protocol>");
    }
  });

  it("sanitizes competitor branding in conversation contents turns", () => {
    const out = ag.transformRequest("gemini-3.8-flash-tiered", {
      request: {
        contents: [
          {
            role: "user",
            parts: [{ text: "x-anthropic-billing-header: test\nYou are Cursor, an intelligent coding assistant created by Anysphere." }],
          },
        ],
      },
    }, true, { projectId: "test-proj" });

    const userText = out.request.contents[0].parts[0].text;
    expect(userText).not.toContain("x-anthropic-billing-header");
    expect(userText).not.toContain("Cursor");
    expect(userText).not.toContain("Anysphere");
    expect(userText).toContain("Antigravity");
  });

  it("attaches X-Aicode-Request-Id and avoids X-Goog-User-Project header", () => {
    const creds = { accessToken: "tok-123", projectId: "test-gcp-project" };
    const transformed = ag.transformRequest("gemini-3.8-flash-tiered", {
      request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    }, true, creds);

    const headers = ag.buildHeaders(creds, true, null, "gemini-3.8-flash-tiered", transformed);
    expect(headers["X-Goog-User-Project"]).toBeUndefined();
    expect(headers["X-Aicode-Request-Id"]).toBe(transformed.requestId);
    expect(headers["User-Agent"]).toBe("antigravity/hub/2.26.0 darwin/arm64");
  });

  it("sanitizes Copilot and ChatGPT system prompts", () => {
    const prompts = [
      "You are GitHub Copilot, an AI pair programmer.",
      "You are ChatGPT, a large language model trained by OpenAI.",
      "You are an AI assistant developed by OpenAI.",
    ];
    for (const prompt of prompts) {
      const out = ag.transformRequest("gemini-3.8-flash-tiered", {
        request: {
          systemInstruction: { parts: [{ text: prompt }] },
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
        },
      }, true, {});
      const text = out.request.systemInstruction.parts[0].text;
      expect(text).not.toContain("Copilot");
      expect(text).not.toContain("ChatGPT");
      expect(text).not.toContain("developed by OpenAI");
    }
  });
  it("sanitizes Windsurf, Continue, Amazon Q, Devin, and Supermaven prompts", () => {
    const prompts = [
      "You are Windsurf, an agentic AI powered by Codeium.",
      "You are Continue, an open-source AI code assistant.",
      "You are Amazon Q, an AI coding companion.",
      "You are Supermaven, the fastest AI code completion tool.",
      "You are Devin, an autonomous AI software engineer.",
    ];
    for (const prompt of prompts) {
      const out = ag.transformRequest("gemini-3.8-flash-tiered", {
        request: {
          systemInstruction: { parts: [{ text: prompt }] },
          contents: [{ role: "user", parts: [{ text: "hi" }] }],
        },
      }, true, {});
      const text = out.request.systemInstruction.parts[0].text;
      expect(text).not.toContain("Windsurf");
      expect(text).not.toContain("Codeium");
      expect(text).not.toContain("Continue");
      expect(text).not.toContain("Amazon Q");
      expect(text).not.toContain("Supermaven");
      expect(text).not.toContain("Devin");
    }
  });

  it("parseError extracts ErrorInfo reasons like ADMIN_SUSPENDED, INELIGIBLE_ACCOUNT, and USER_PROJECT_DENIED", () => {
    const errorPayload = JSON.stringify({
      error: {
        code: 403,
        message: "Account suspended",
        status: "PERMISSION_DENIED",
        details: [
          {
            "@type": "type.googleapis.com/google.rpc.ErrorInfo",
            reason: "ADMIN_SUSPENDED",
            domain: "googleapis.com",
          },
        ],
      },
    });

    const parsed = ag.parseError({ status: 403 }, errorPayload);
    expect(parsed.status).toBe(403);
    expect(parsed.message).toContain("ADMIN_SUSPENDED");
  });

  it("checkFallbackError treats ADMIN_SUSPENDED with max cooldown and PROHIBITED_USE_POLICY as request-scoped", async () => {
    const { checkFallbackError } = await import("../../open-sse/services/accountFallback.js");
    const { MAX_RATE_LIMIT_COOLDOWN_MS } = await import("../../open-sse/config/errorConfig.js");

    const adminSuspended = checkFallbackError(403, "[ADMIN_SUSPENDED] User is suspended", 0, "antigravity");
    expect(adminSuspended.shouldFallback).toBe(true);
    expect(adminSuspended.cooldownMs).toBe(MAX_RATE_LIMIT_COOLDOWN_MS);

    const pup = checkFallbackError(400, "GRANULAR_FINISH_REASON_PROHIBITED_USE_POLICY_LIMITED_DISABLED", 0, "antigravity");
    expect(pup.shouldFallback).toBe(false);
    expect(pup.requestScoped).toBe(true);
  });
});
