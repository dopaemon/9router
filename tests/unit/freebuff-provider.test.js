import { describe, it, expect } from "vitest";
import { PROVIDERS } from "../../open-sse/config/providers.js";
import { PROVIDER_MODELS } from "../../open-sse/config/providerModels.js";
import { AI_PROVIDERS } from "../../src/shared/constants/providers.js";

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

  it("exports freebuff UI metadata in AI_PROVIDERS", () => {
    const entry = AI_PROVIDERS["freebuff"];
    expect(entry).toBeDefined();
    expect(entry.name).toBe("Freebuff");
    expect(entry.textIcon).toBe("FB");
    expect(entry.website).toBe("https://freebuff.com");
  });
});
