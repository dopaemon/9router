import { ensureDirs, DATA_FILE } from "./paths.js";

// Use global to survive Next.js dev hot-reload (module state resets on reload)
if (!global._dbAdapter) global._dbAdapter = { instance: null, initPromise: null, logged: false };
const state = global._dbAdapter;

async function tryBunSqlite() {
  // Bun runtime only — built-in, no install needed
  if (!process.versions.bun) return null;
  try {
    const { createBunSqliteAdapter } = await import("./adapters/bunSqliteAdapter.js");
    return await createBunSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] bun:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function tryBetterSqlite() {
  // Skip on Bun — better-sqlite3 native bindings unsupported
  if (process.versions.bun) return null;
  // Skip on Node >= 24: the native addon SIGSEGVs on load there, which is a
  // process-level crash the try/catch below cannot recover from. node:sqlite covers it.
  const [nodeMajor] = process.versions.node.split(".").map(Number);
  if (nodeMajor >= 24) return null;
  try {
    const { createBetterSqliteAdapter } = await import("./adapters/betterSqliteAdapter.js");
    return createBetterSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] better-sqlite3 unavailable: ${e.message}`);
    return null;
  }
}

async function tryNodeSqlite() {
  // Built-in since Node 22.5.0 — no install needed. Skip under Bun (no node:sqlite).
  if (process.versions.bun) return null;
  const [maj, min] = process.versions.node.split(".").map(Number);
  if (maj < 22 || (maj === 22 && min < 5)) return null;
  try {
    const { createNodeSqliteAdapter } = await import("./adapters/nodeSqliteAdapter.js");
    return await createNodeSqliteAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] node:sqlite unavailable: ${e.message}`);
    return null;
  }
}

async function trySqlJs() {
  try {
    const { createSqlJsAdapter } = await import("./adapters/sqljsAdapter.js");
    return await createSqlJsAdapter(DATA_FILE);
  } catch (e) {
    console.warn(`[DB] sql.js unavailable: ${e.message}`);
    return null;
  }
}
export function isCfD1Enabled() {
  const flag = (process.env.CF_D1 || process.env.USE_CF_D1 || "").trim().toLowerCase();
  return flag === "true" || flag === "1";
}

export function getCfD1Config() {
  const accountId = (process.env.CF_ACCOUNT_ID || process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
  const databaseId = (process.env.CF_DATABASE_ID || process.env.CF_D1_DATABASE_ID || process.env.CLOUDFLARE_DATABASE_ID || "").trim();
  const apiToken = (process.env.CF_API_TOKEN || process.env.CF_D1_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN || "").trim();
  return { accountId, databaseId, apiToken };
}

// Supabase / any Postgres. Explicit opt-in via connection string — when set it
// wins over the local SQLite file and there is NO silent fallback: a bad URL
// must fail loudly rather than quietly serving an empty local DB (which would
// look like total data loss, and would hand out fresh API keys).
export function getPostgresUrl() {
  const url = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "";
  return url.trim() || null;
}
async function initAdapter() {
  const { readDbConfig } = await import("./setupStatus.js");
  const fileConfig = readDbConfig();

  if (isCfD1Enabled()) {
    const { accountId, databaseId, apiToken } = getCfD1Config();
    if (!accountId || !databaseId || !apiToken) {
      throw new Error("[DB] CF_D1 is enabled but CF_ACCOUNT_ID, CF_DATABASE_ID, or CF_API_TOKEN is missing");
    }
    const { createCloudflareD1Adapter } = await import("./adapters/cloudflareD1Adapter.js");
    const adapter = createCloudflareD1Adapter({ accountId, databaseId, apiToken });
    if (!state.logged) {
      console.log(`[DB] Driver: ${adapter.driver} | database: ${databaseId.slice(0, 8)}...`);
      state.logged = true;
    }
    const { runMigrationOnce } = await import("./migrate.js");
    await runMigrationOnce(adapter);
    return adapter;
  }

  if (fileConfig?.driver === "cloudflare-d1" && fileConfig.d1) {
    const { accountId, databaseId, apiToken } = fileConfig.d1;
    if (accountId && databaseId && apiToken) {
      const { createCloudflareD1Adapter } = await import("./adapters/cloudflareD1Adapter.js");
      const adapter = createCloudflareD1Adapter({ accountId, databaseId, apiToken });
      if (!state.logged) {
        console.log(`[DB] Driver: ${adapter.driver} (configured via setup) | database: ${databaseId.slice(0, 8)}...`);
        state.logged = true;
      }
      const { runMigrationOnce } = await import("./migrate.js");
      await runMigrationOnce(adapter);
      return adapter;
    }
  }

  const pgUrl = getPostgresUrl() || (fileConfig?.driver === "postgres" ? fileConfig?.postgres?.url : null);
  if (pgUrl) {
    const { createPostgresAdapter } = await import("./adapters/postgresAdapter.js");
    const adapter = await createPostgresAdapter(pgUrl);
    if (!state.logged) {
      // Never log the URL itself — it carries the DB password.
      console.log(`[DB] Driver: ${adapter.driver} | host: ${safeHost(pgUrl)}`);
      state.logged = true;
    }
    const { runMigrationOnce } = await import("./migrate.js");
    await runMigrationOnce(adapter);
    return adapter;
  }

  ensureDirs();
  // Order per runtime:
  //   Bun:  bun:sqlite → sql.js
  //   Node: better-sqlite3 → node:sqlite (≥22.5) → sql.js
  let adapter = await tryBunSqlite();
  if (!adapter) adapter = await tryBetterSqlite();
  if (!adapter) adapter = await tryNodeSqlite();
  if (!adapter) adapter = await trySqlJs();
  if (!adapter) throw new Error("[DB] No SQLite driver available (bun/better/node/sql.js all failed)");

  if (!state.logged) {
    console.log(`[DB] Driver: ${adapter.driver} | file: ${DATA_FILE}`);
    state.logged = true;
  }

  const { runMigrationOnce } = await import("./migrate.js");
  await runMigrationOnce(adapter);
  return adapter;
}

export async function getAdapter() {
  if (state.instance) return state.instance;
  if (!state.initPromise) state.initPromise = initAdapter().then((a) => { state.instance = a; return a; });
  return state.initPromise;
}

function safeHost(url) {
  try { const u = new URL(url); return `${u.hostname}:${u.port || 5432}${u.pathname}`; }
  catch { return "unknown"; }
}

export function getAdapterSync() {
  if (!state.instance) throw new Error("[DB] adapter not initialized — await getAdapter() first");
  return state.instance;
}

export async function resetAdapter() {
  if (state.instance?.close) {
    try { await state.instance.close(); } catch {}
  }
  state.instance = null;
  state.initPromise = null;
  state.logged = false;
  return getAdapter();
}
