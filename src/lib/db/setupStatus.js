import fs from "node:fs";
import path from "node:path";
import { DATA_DIR as DEFAULT_DATA_DIR } from "./paths.js";

function currentDataDir() {
  return process.env.DATA_DIR || DEFAULT_DATA_DIR;
}

function currentConfigFile() {
  return path.join(currentDataDir(), "db-config.json");
}

function currentDataFile() {
  return path.join(currentDataDir(), "db", "data.sqlite");
}

export function readDbConfig() {
  try {
    const cfgPath = currentConfigFile();
    if (fs.existsSync(cfgPath)) {
      const raw = fs.readFileSync(cfgPath, "utf-8");
      return JSON.parse(raw);
    }
  } catch (e) {
    console.warn("[DB][setup] Could not read db-config.json:", e.message);
  }
  return null;
}

export function writeDbConfig(cfg) {
  try {
    const dir = currentDataDir();
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(currentConfigFile(), JSON.stringify(cfg, null, 2), "utf-8");
    return true;
  } catch (e) {
    console.error("[DB][setup] Failed to write db-config.json:", e.message);
    return false;
  }
}

export function clearDbSetupConfig() {
  try {
    const cfgPath = currentConfigFile();
    if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
  } catch (e) {
    console.warn("[DB][setup] Failed to remove db-config.json:", e.message);
  }

  delete process.env.CF_D1;
  delete process.env.USE_CF_D1;
  delete process.env.CF_ACCOUNT_ID;
  delete process.env.CF_DATABASE_ID;
  delete process.env.CF_API_TOKEN;
  delete process.env.SUPABASE_DB_URL;
  delete process.env.DATABASE_URL;
  delete process.env.SETUP_COMPLETED;

  const targetPaths = [
    path.join(currentDataDir(), ".env"),
    path.join(process.cwd(), ".env"),
  ];

  for (const envPath of targetPaths) {
    try {
      if (!fs.existsSync(envPath)) continue;
      let content = fs.readFileSync(envPath, "utf-8");
      content = upsertEnvVar(content, "CF_D1", "false");
      content = upsertEnvVar(content, "SETUP_COMPLETED", "false");
      const reSupabase = /^#?\s*SUPABASE_DB_URL=.*$/m;
      if (reSupabase.test(content)) content = content.replace(reSupabase, "# SUPABASE_DB_URL=");
      fs.writeFileSync(envPath, content, "utf-8");
    } catch {}
  }
}

export function upsertEnvVar(content, key, value) {
  const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(content)) return content.replace(re, line);
  return content ? `${content.trimEnd()}\n${line}\n` : `${line}\n`;
}

export function saveEnvConfig(cfg) {
  // 1. Immediately apply to running process.env so subsequent requests recognize completion
  if (cfg.driver === "cloudflare-d1") {
    process.env.CF_D1 = "true";
    if (cfg.d1?.accountId) process.env.CF_ACCOUNT_ID = cfg.d1.accountId;
    if (cfg.d1?.databaseId) process.env.CF_DATABASE_ID = cfg.d1.databaseId;
    if (cfg.d1?.apiToken) process.env.CF_API_TOKEN = cfg.d1.apiToken;
  } else if (cfg.driver === "postgres") {
    process.env.CF_D1 = "false";
    if (cfg.postgres?.url) process.env.SUPABASE_DB_URL = cfg.postgres.url;
    process.env.PGSSL_NO_VERIFY = "1";
  } else {
    process.env.CF_D1 = "false";
  }
  process.env.SETUP_COMPLETED = "true";

  // 2. Persist to candidate .env locations:
  //    - ~/.9router/.env (always preserved by CLI across installs/updates)
  //    - process.cwd()/.env (local dev root)
  const targetPaths = [
    path.join(currentDataDir(), ".env"),
    path.join(process.cwd(), ".env"),
  ];

  for (const envPath of targetPaths) {
    try {
      let content = "";
      if (fs.existsSync(envPath)) {
        content = fs.readFileSync(envPath, "utf-8");
      } else {
        const examplePath = path.join(process.cwd(), ".env.example");
        if (fs.existsSync(examplePath)) {
          content = fs.readFileSync(examplePath, "utf-8");
        }
      }

      if (cfg.driver === "cloudflare-d1") {
        content = upsertEnvVar(content, "CF_D1", "true");
        content = upsertEnvVar(content, "CF_ACCOUNT_ID", cfg.d1?.accountId || "");
        content = upsertEnvVar(content, "CF_DATABASE_ID", cfg.d1?.databaseId || "");
        content = upsertEnvVar(content, "CF_API_TOKEN", cfg.d1?.apiToken || "");
      } else if (cfg.driver === "postgres") {
        content = upsertEnvVar(content, "CF_D1", "false");
        content = upsertEnvVar(content, "SUPABASE_DB_URL", cfg.postgres?.url || "");
        content = upsertEnvVar(content, "PGSSL_NO_VERIFY", "1");
      } else {
        content = upsertEnvVar(content, "CF_D1", "false");
      }

      content = upsertEnvVar(content, "SETUP_COMPLETED", "true");
      const parentDir = path.dirname(envPath);
      if (!fs.existsSync(parentDir)) fs.mkdirSync(parentDir, { recursive: true });
      fs.writeFileSync(envPath, content, "utf-8");
    } catch (e) {
      console.warn(`[DB][setup] Could not update ${envPath}:`, e.message);
    }
  }
  return true;
}

function loadEnvIfPresent(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const content = fs.readFileSync(filePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eq = trimmed.indexOf("=");
        if (eq > 0) {
          const k = trimmed.slice(0, eq).trim();
          const v = trimmed.slice(eq + 1).trim();
          if (k && !process.env[k]) {
            process.env[k] = v;
          }
        }
      }
    }
  } catch {}
}

export function isSetupComplete() {
  // Ensure any .env on disk is parsed into process.env
  loadEnvIfPresent(path.join(currentDataDir(), ".env"));
  loadEnvIfPresent(path.join(process.cwd(), ".env"));

  const cfD1 = (process.env.CF_D1 || process.env.USE_CF_D1 || "").trim().toLowerCase();
  if (cfD1 === "true" || cfD1 === "1") return true;

  const pgUrl = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (pgUrl) return true;

  if (process.env.SETUP_COMPLETED === "true" || process.env.SETUP_COMPLETED === "1") return true;

  const fileConfig = readDbConfig();
  if (fileConfig?.configured === true) return true;

  return false;
}
