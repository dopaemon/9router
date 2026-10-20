import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGet, mockRun, mockGetAdapter } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockRun: vi.fn(),
  mockGetAdapter: vi.fn(),
}));

vi.mock("@/lib/db/driver.js", () => ({
  getAdapter: mockGetAdapter,
}));

vi.mock("@/lib/db/repos/settingsRepo.js", () => ({
  getSettings: vi.fn().mockResolvedValue({ supabaseKeepAliveEnabled: true }),
  updateSettings: vi.fn().mockResolvedValue({}),
}));

import { runSupabaseKeepAlivePing } from "@/shared/services/supabaseKeepAlive.js";

describe("Supabase KeepAlive Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("skips keepalive when driver is not postgres", async () => {
    mockGetAdapter.mockResolvedValueOnce({
      dialect: "sqlite",
    });

    const res = await runSupabaseKeepAlivePing();
    expect(res.skipped).toBe(true);
  });

  it("executes real query and upserts meta record when postgres adapter is active", async () => {
    mockGet.mockResolvedValueOnce({
      server_time: "2026-10-20T12:00:00Z",
      db_name: "postgres",
      pg_version: "PostgreSQL 16",
    });
    mockRun.mockResolvedValueOnce({ changes: 1 });

    mockGetAdapter.mockResolvedValueOnce({
      dialect: "postgres",
      get: mockGet,
      run: mockRun,
    });

    const res = await runSupabaseKeepAlivePing();
    expect(res.success).toBe(true);
    expect(mockGet).toHaveBeenCalledWith(expect.stringContaining("SELECT NOW()"));
    expect(mockRun).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO _meta"),
      expect.any(Array)
    );
  });
});
