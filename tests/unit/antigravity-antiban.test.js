import { describe, expect, it } from "vitest";
import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { ANTIGRAVITY_PROMPT_REWRITES } from "../../open-sse/config/appConstants.js";
import { ANTIGRAVITY_IDE_VERSION } from "../../open-sse/providers/shared.js";

describe("Antigravity Antiban protections", () => {
  const ag = new AntigravityExecutor();

  it("injects official Antigravity IDE metadata in transformRequest", () => {
    const out = ag.transformRequest("gemini-3.8-flash-tiered", {
      request: {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      },
    }, true, { projectId: "test-proj", connectionId: "conn-1" });

    expect(out.metadata).toEqual({
      ideName: "antigravity",
      ideVersion: ANTIGRAVITY_IDE_VERSION,
    });
    expect(out.userAgent).toBe("antigravity");
  });

  it("preserves explicit custom metadata if provided", () => {
    const custom = { ideName: "antigravity", ideVersion: "2.24.0", customField: true };
    const out = ag.transformRequest("gemini-3.8-flash-tiered", {
      metadata: custom,
      request: {
        contents: [{ role: "user", parts: [{ text: "Hello" }] }],
      },
    }, true, { projectId: "test-proj", connectionId: "conn-1" });

    expect(out.metadata).toBe(custom);
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

  it("attaches X-Goog-User-Project and X-Aicode-Request-Id matching language_server", () => {
    const creds = { accessToken: "tok-123", projectId: "test-gcp-project" };
    const transformed = ag.transformRequest("gemini-3.8-flash-tiered", {
      request: { contents: [{ role: "user", parts: [{ text: "hi" }] }] },
    }, true, creds);

    const headers = ag.buildHeaders(creds, true, null, "gemini-3.8-flash-tiered", transformed);
    expect(headers["X-Goog-User-Project"]).toBe("test-gcp-project");
    expect(headers["X-Goog-Request-Reason"]).toBe("conversational");
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
});
