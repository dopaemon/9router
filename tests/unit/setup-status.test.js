import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { isSetupComplete, upsertEnvVar } from "@/lib/db/setupStatus.js";

describe("Setup Status & Env Helpers", () => {
  const origEnv = { ...process.env };
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "9router-setup-"));
    process.env = { ...origEnv };
    delete process.env.CF_D1;
    delete process.env.USE_CF_D1;
    delete process.env.SUPABASE_DB_URL;
    delete process.env.DATABASE_URL;
    delete process.env.SETUP_COMPLETED;
    process.env.DATA_DIR = tempDir;
  });

  afterEach(() => {
    process.env = { ...origEnv };
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("upsertEnvVar adds new key if missing", () => {
    const res = upsertEnvVar("FOO=1\n", "BAR", "2");
    expect(res).toContain("FOO=1");
    expect(res).toContain("BAR=2");
  });

  it("upsertEnvVar updates existing key", () => {
    const res = upsertEnvVar("CF_D1=false\nPORT=20127\n", "CF_D1", "true");
    expect(res).toContain("CF_D1=true");
    expect(res).not.toContain("CF_D1=false");
  });

  it("upsertEnvVar uncomments commented key", () => {
    const res = upsertEnvVar("# CF_D1=false\nPORT=20127\n", "CF_D1", "true");
    expect(res).toContain("CF_D1=true");
    expect(res).not.toContain("# CF_D1=false");
  });

  it("isSetupComplete returns true when CF_D1=true", () => {
    process.env.CF_D1 = "true";
    expect(isSetupComplete()).toBe(true);
  });

  it("isSetupComplete returns true when SUPABASE_DB_URL is set", () => {
    process.env.SUPABASE_DB_URL = "postgresql://localhost:5432/db";
    expect(isSetupComplete()).toBe(true);
  });

  it("isSetupComplete returns true when SETUP_COMPLETED=true", () => {
    process.env.SETUP_COMPLETED = "true";
    expect(isSetupComplete()).toBe(true);
  });

  it("isSetupComplete returns false on fresh directory without env or config", () => {
    expect(isSetupComplete()).toBe(false);
  });
});
