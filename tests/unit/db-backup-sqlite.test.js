import { describe, it, expect } from "vitest";
import { exportDbToSqliteBuffer, extractPayloadFromSqliteBuffer } from "@/lib/db/helpers/sqliteExportImport.js";
import { exportDbSqlite, importDbFromSqlite, exportDb } from "@/lib/db/index.js";

describe("SQLite Database Backup & Restore", () => {
  const samplePayload = {
    settings: {
      siteName: "Test 9Router",
      defaultModel: "gpt-4o",
      enableObservability: true,
    },
    providerConnections: [
      {
        id: "conn-test-1",
        provider: "openai",
        authType: "apikey",
        name: "OpenAI Primary",
        priority: 1,
        isActive: true,
        apiKey: "sk-test-key",
      },
    ],
    providerNodes: [
      {
        id: "node-1",
        type: "openai-compatible",
        name: "Local Node",
      },
    ],
    proxyPools: [
      {
        id: "pool-1",
        isActive: true,
        testStatus: "active",
      },
    ],
    apiKeys: [
      {
        id: "key-1",
        key: "sk-9r-test-12345",
        name: "Default Key",
        isActive: true,
      },
    ],
    combos: [
      {
        id: "combo-1",
        name: "Smart Route",
        kind: "llm",
        models: ["gpt-4o", "claude-3-7-sonnet"],
      },
    ],
    modelAliases: {
      fast: "gpt-4o-mini",
    },
    customModels: [
      {
        providerAlias: "oa",
        id: "custom-gpt",
        type: "llm",
        name: "Custom GPT",
      },
    ],
    mitmAlias: {
      cursor: { "claude-3-5-sonnet": "gpt-4o" },
    },
    pricing: {
      openai: { "gpt-4o": { prompt: 2.5, completion: 10 } },
    },
    disabledModels: {
      openai: ["gpt-3.5-turbo"],
    },
  };

  it("exports payload into a valid SQLite binary buffer", async () => {
    const buffer = await exportDbToSqliteBuffer(samplePayload);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBeGreaterThan(100);

    // Verify SQLite header magic bytes
    const header = buffer.subarray(0, 16).toString("utf8");
    expect(header.startsWith("SQLite format 3")).toBe(true);
  });

  it("extracts payload from SQLite binary buffer preserving all tables and fields", async () => {
    const buffer = await exportDbToSqliteBuffer(samplePayload);
    const restored = await extractPayloadFromSqliteBuffer(buffer);

    // Settings
    expect(restored.settings).toEqual(samplePayload.settings);

    // Provider connections
    expect(restored.providerConnections).toHaveLength(1);
    expect(restored.providerConnections[0].id).toBe("conn-test-1");
    expect(restored.providerConnections[0].provider).toBe("openai");
    expect(restored.providerConnections[0].name).toBe("OpenAI Primary");
    expect(restored.providerConnections[0].apiKey).toBe("sk-test-key");
    expect(restored.providerConnections[0].isActive).toBe(true);

    // API Keys
    expect(restored.apiKeys).toHaveLength(1);
    expect(restored.apiKeys[0].id).toBe("key-1");
    expect(restored.apiKeys[0].key).toBe("sk-9r-test-12345");

    // Combos
    expect(restored.combos).toHaveLength(1);
    expect(restored.combos[0].id).toBe("combo-1");
    expect(restored.combos[0].models).toEqual(["gpt-4o", "claude-3-7-sonnet"]);

    // KV stores
    expect(restored.modelAliases).toEqual({ fast: "gpt-4o-mini" });
    expect(restored.customModels).toHaveLength(1);
    expect(restored.customModels[0].id).toBe("custom-gpt");
    expect(restored.mitmAlias).toEqual({ cursor: { "claude-3-5-sonnet": "gpt-4o" } });
    expect(restored.pricing).toEqual({ openai: { "gpt-4o": { prompt: 2.5, completion: 10 } } });
    expect(restored.disabledModels).toEqual({ openai: ["gpt-3.5-turbo"] });
  });

  it("rejects non-SQLite files with descriptive error", async () => {
    const invalidBuffer = Buffer.from("Not a sqlite file, just plain text");
    await expect(extractPayloadFromSqliteBuffer(invalidBuffer)).rejects.toThrow(
      "Invalid file format: not a SQLite database file"
    );
  });

  it("exportDbToSqliteBuffer and extractPayloadFromSqliteBuffer round-trip cleanly", async () => {
    const sqliteBuf = await exportDbToSqliteBuffer(samplePayload);
    expect(sqliteBuf).toBeInstanceOf(Buffer);
    expect(sqliteBuf.length).toBeGreaterThan(0);

    const reimported = await extractPayloadFromSqliteBuffer(sqliteBuf);
    expect(reimported).toBeDefined();
    expect(reimported.settings).toEqual(samplePayload.settings);
  });
});
