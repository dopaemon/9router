import { describe, it, expect } from "vitest";
import { readDbConfig, writeDbConfig } from "@/lib/db/setupStatus.js";
import { exportDbToSqliteBuffer, extractPayloadFromSqliteBuffer } from "@/lib/db/helpers/sqliteExportImport.js";

describe("Database Selection & Settings Switch", () => {
  it("writes and reads database config correctly", () => {
    const originalConfig = readDbConfig();

    try {
      const testCfg = {
        configured: true,
        driver: "cloudflare-d1",
        d1: {
          accountId: "test-acc-123",
          databaseId: "test-db-456",
          apiToken: "test-token-789",
        },
      };

      writeDbConfig(testCfg);
      const readBack = readDbConfig();
      expect(readBack).toBeDefined();
      expect(readBack.driver).toBe("cloudflare-d1");
      expect(readBack.d1.accountId).toBe("test-acc-123");
      expect(readBack.d1.databaseId).toBe("test-db-456");
    } finally {
      if (originalConfig) {
        writeDbConfig(originalConfig);
      } else {
        writeDbConfig({ configured: true, driver: "sqlite" });
      }
    }
  });

  it("extractPayloadFromSqliteBuffer handles buffers without external wasm", async () => {
    const sample = {
      settings: { siteName: "Wasm-Free Test" },
      providerConnections: [
        { id: "c1", provider: "ollama", name: "Local Ollama", priority: 2, isActive: true },
      ],
      apiKeys: [],
      combos: [],
      modelAliases: {},
      customModels: [],
      mitmAlias: {},
      pricing: {},
      disabledModels: {},
    };

    const buf = await exportDbToSqliteBuffer(sample);
    expect(buf).toBeInstanceOf(Buffer);
    expect(buf.length).toBeGreaterThan(100);

    const extracted = await extractPayloadFromSqliteBuffer(buf);
    expect(extracted.settings).toEqual(sample.settings);
    expect(extracted.providerConnections).toHaveLength(1);
    expect(extracted.providerConnections[0].id).toBe("c1");
  });
});
