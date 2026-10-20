import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createCloudflareD1Adapter } from "@/lib/db/adapters/cloudflareD1Adapter.js";
import { isCfD1Enabled, getCfD1Config } from "@/lib/db/driver.js";

describe("Cloudflare D1 Adapter", () => {
  const origEnv = { ...process.env };

  beforeEach(() => {
    vi.restoreAllMocks();
    process.env = { ...origEnv };
  });

  afterEach(() => {
    process.env = { ...origEnv };
  });

  it("detects CF_D1 flag and config correctly", () => {
    delete process.env.CF_D1;
    expect(isCfD1Enabled()).toBe(false);

    process.env.CF_D1 = "true";
    expect(isCfD1Enabled()).toBe(true);

    process.env.CF_D1 = "1";
    expect(isCfD1Enabled()).toBe(true);

    process.env.CF_D1 = "false";
    expect(isCfD1Enabled()).toBe(false);

    process.env.CF_ACCOUNT_ID = "acc123";
    process.env.CF_DATABASE_ID = "db456";
    process.env.CF_API_TOKEN = "tok789";

    const cfg = getCfD1Config();
    expect(cfg.accountId).toBe("acc123");
    expect(cfg.databaseId).toBe("db456");
    expect(cfg.apiToken).toBe("tok789");
  });

  it("throws error when creating adapter without credentials", () => {
    expect(() => createCloudflareD1Adapter({ accountId: "", databaseId: "x", apiToken: "y" }))
      .toThrow("[DB] Cloudflare D1 requires accountId, databaseId, and apiToken");
  });

  it("executes get, all, run, exec, and transaction via mocked fetch", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url, opts) => {
      expect(url).toBe("https://api.cloudflare.com/client/v4/accounts/test-acc/d1/database/test-db/query");
      expect(opts.headers.Authorization).toBe("Bearer test-token");

      const body = JSON.parse(opts.body);

      if (body.sql?.includes("SELECT * FROM settings")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: [
              {
                success: true,
                results: [{ id: 1, data: '{"theme":"dark"}' }],
                meta: { changes: 0, last_row_id: 1 },
              },
            ],
          }),
        };
      }

      if (body.sql?.includes("INSERT INTO settings")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: [
              {
                success: true,
                results: [],
                meta: { changes: 1, last_row_id: 1 },
              },
            ],
          }),
        };
      }

      if (body.sql?.includes("PRAGMA table_info")) {
        return {
          ok: true,
          json: async () => ({
            success: true,
            result: [
              {
                success: true,
                results: [{ name: "id" }, { name: "data" }],
                meta: {},
              },
            ],
          }),
        };
      }

      return {
        ok: true,
        json: async () => ({
          success: true,
          result: [{ success: true, results: [], meta: {} }],
        }),
      };
    });

    vi.stubGlobal("fetch", mockFetch);

    const adapter = createCloudflareD1Adapter({
      accountId: "test-acc",
      databaseId: "test-db",
      apiToken: "test-token",
    });

    expect(adapter.driver).toBe("cloudflare-d1");
    expect(adapter.dialect).toBe("sqlite");

    // test get
    const row = await adapter.get("SELECT * FROM settings WHERE id = ?", [1]);
    expect(row).toEqual({ id: 1, data: '{"theme":"dark"}' });

    // test all
    const allRows = await adapter.all("SELECT * FROM settings");
    expect(allRows).toEqual([{ id: 1, data: '{"theme":"dark"}' }]);

    // test run
    const runRes = await adapter.run("INSERT INTO settings(id, data) VALUES(?, ?)", [1, "{}"]);
    expect(runRes.changes).toBe(1);

    // test listColumns
    const cols = await adapter.listColumns("settings");
    expect(cols).toEqual(["id", "data"]);

    // test exec
    await adapter.exec("CREATE TABLE foo(id INT);");
    expect(mockFetch).toHaveBeenCalled();

    // test transaction
    await adapter.transaction(async (tx) => {
      await tx.run("INSERT INTO settings(id, data) VALUES(?, ?)", [2, "{}"]);
    });
  });

  it("handles D1 API errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      json: async () => ({
        success: false,
        errors: [{ code: 7500, message: "syntax error near FOO" }],
      }),
    }));

    const adapter = createCloudflareD1Adapter({
      accountId: "test-acc",
      databaseId: "test-db",
      apiToken: "test-token",
    });

    await expect(adapter.run("INVALID SQL")).rejects.toThrow("[DB][D1] Query failed: syntax error near FOO");
  });
});
