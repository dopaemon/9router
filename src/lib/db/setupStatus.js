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

export function upsertEnvVar(content, key, value) {
  const re = new RegExp(`^#?\\s*${key}=.*$`, "m");
  const line = `${key}=${value}`;
  if (re.test(content)) return content.replace(re, line);
  return content ? `${content.trimEnd()}\n${line}\n` : `${line}\n`;
}

export function saveEnvConfig(cfg) {
  try {
    const envPath = path.join(process.cwd(), ".env");
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
    fs.writeFileSync(envPath, content, "utf-8");
    return true;
  } catch (e) {
    console.warn("[DB][setup] Could not update .env file:", e.message);
    return false;
  }
}

export function isSetupComplete() {
  const cfD1 = (process.env.CF_D1 || process.env.USE_CF_D1 || "").trim().toLowerCase();
  if (cfD1 === "true" || cfD1 === "1") return true;

  const pgUrl = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (pgUrl) return true;

  if (process.env.SETUP_COMPLETED === "true" || process.env.SETUP_COMPLETED === "1") return true;

  const fileConfig = readDbConfig();
  if (fileConfig?.configured === true) return true;

  // Existing install check: if data.sqlite already existed before this feature,
  // treat as completed to avoid disrupting existing local databases.
  try {
    const dataFile = currentDataFile();
    if (fs.existsSync(dataFile) && fs.statSync(dataFile).size > 0) {
      writeDbConfig({ configured: true, driver: "sqlite" });
      return true;
    }
  } catch {}

  return false;
}
