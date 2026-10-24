import { describe, it, expect, vi } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { AI_PROVIDERS, OAUTH_PROVIDERS } from "../../src/shared/constants/providers.js";
import { BaseExecutor } from "../../open-sse/executors/base.js";
import freebuffOAuth from "../../src/lib/oauth/providers/freebuff.js";

describe("Freebuff provider registry", () => {
  it("registers freebuff in PROVIDERS", () => {
    const config = PROVIDERS["freebuff"];
    expect(config).toBeDefined();
    expect(config.baseUrl).toBe("https://freebuff.com/api/v1/paid/chat/completions");
    expect(config.format).toBe("openai");
  });

  it("registers models for freebuff", () => {
    const models = PROVIDER_MODELS["freebuff"];
    expect(models).toBeDefined();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === "deepseek-v4.1-flash")).toBe(true);
    expect(models.some((m) => m.id === "claude-sonnet-5-5")).toBe(true);
  });

  it("exports freebuff UI metadata in AI_PROVIDERS and OAUTH_PROVIDERS", () => {
    const entry = AI_PROVIDERS["freebuff"];
    expect(entry).toBeDefined();
    expect(entry.name).toBe("Freebuff");
    expect(entry.textIcon).toBe("FB");
    expect(entry.hasOAuth).toBe(true);
    expect(entry.authModes).toEqual(["oauth", "apikey"]);
    expect(OAUTH_PROVIDERS["freebuff"]).toBeDefined();
  });

  it("routes OAuth connections to codebuff completions and API keys to freebuff paid endpoint", () => {
    const executor = new BaseExecutor("freebuff", PROVIDERS["freebuff"]);
    const oauthUrl = executor.buildUrl("deepseek-v4-flash", true, 0, { accessToken: "tok-123" });
    expect(oauthUrl).toBe("https://codebuff.com/api/v1/chat/completions");

    const apiKeyUrl = executor.buildUrl("deepseek-v4-flash", true, 0, { apiKey: "key-123" });
    expect(apiKeyUrl).toBe("https://freebuff.com/api/v1/paid/chat/completions");
  });

  it("handles OAuth device code flow and token mapping", async () => {
    expect(freebuffOAuth.flowType).toBe("device_code");

    // mock successful poll
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(JSON.stringify({
        user: {
          id: "u-123",
          email: "user@test.local",
          name: "Tester",
          authToken: "auth-tok-abc",
          fingerprintId: "fp-1",
        }
      }), { status: 200, headers: { "Content-Type": "application/json" } })
    );

    const pollRes = await freebuffOAuth.pollToken(freebuffOAuth.config, "fp-1:hash-1:" + (Date.now() + 60000));
    expect(pollRes.ok).toBe(true);
    expect(pollRes.data.access_token).toBe("auth-tok-abc");

    const mapped = freebuffOAuth.mapTokens(pollRes.data);
    expect(mapped.accessToken).toBe("auth-tok-abc");
    expect(mapped.email).toBe("user@test.local");
    expect(mapped.providerSpecificData.baseUrl).toBe("https://codebuff.com/api/v1/chat/completions");

    fetchSpy.mockRestore();
  });
});
