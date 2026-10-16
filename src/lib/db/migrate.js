import fs from "node:fs";
import path from "node:path";
import { LEGACY_FILES, DB_DIR } from "./paths.js";
import { TABLES, buildCreateTableSql, SCHEMA_VERSION } from "./schema.js";
import { MIGRATIONS, latestVersion } from "./migrations/index.js";
import { getMetaOn, setMetaOn } from "./helpers/metaStore.js";
import { makeBackupDir, backupFile, backupDbLite, pruneOldBackups } from "./backup.js";
import { getAppVersion } from "./version.js";
import { stringifyJson } from "./helpers/jsonCol.js";
import { upsertSql } from "./sqlDialect.js";

// Marker file: prevents re-importing legacy JSON when user wipes data.sqlite.
const MIGRATED_MARKER = path.join(DB_DIR, ".migrated-from-json");

// Track per-adapter so reusing same adapter skips re-run, but new adapter (after reset) re-runs.
const _migratedAdapters = new WeakSet();

// Thrown when row-count assertion fails. Outer transaction rolls back,
// legacy db.json kept intact, marker not written → next boot retries.
export class MigrationAborted extends Error {
  constructor(message, droppedRows) {
    super(message);
    this.name = "MigrationAborted";
    this.droppedRows = droppedRows;
  }
}

// Insert rows one-by-one, collect failures, then assert COUNT(*) matches input length.
async function importWithAssertion(adapter, tableName, rows, insertFn, rowMeta) {
  const dropped = [];
  for (const row of rows) {
    try { await insertFn(row); }
    catch (err) { dropped.push({ ...rowMeta(row), reason: err.message }); }
  }
  // Postgres returns bigint counts as strings — compare numerically.
  const inserted = Number((await adapter.get(`SELECT COUNT(*) as c FROM ${tableName}`))?.c ?? 0);
  if (inserted !== rows.length) {
    console.warn(`[DB][migrate] ${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}. Dropped:`, dropped);
    throw new MigrationAborted(`${tableName} row-count mismatch: expected ${rows.length}, got ${inserted}`, dropped);
  }
}

function readJsonSafe(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, "utf-8")); } catch { return null; }
}

async function isFreshDb(adapter) {
  // Table _meta may not exist yet on truly fresh DB
  try {
    const row = await adapter.get(`SELECT COUNT(*) as c FROM _meta`);
    return !row || Number(row.c) === 0;
  } catch {
    return true;
  }
}

// ─── Versioned migrations runner (skip-version safe) ─────────────────────
async function runVersionedMigrations(adapter) {
  // Bootstrap _meta first so we can read schemaVersion
  await adapter.exec(buildCreateTableSql("_meta", TABLES._meta, adapter.dialect));

  const current = parseInt(await getMetaOn(adapter, "schemaVersion", "0"), 10) || 0;
  const target = latestVersion();
  if (current >= target) return { applied: 0, from: current, to: current };

  const pending = MIGRATIONS.filter((m) => m.version > current);
  let lastApplied = current;
  for (const m of pending) {
    await adapter.transaction(async (tx) => {
      await m.up(tx, adapter.dialect);
      await setMetaOn(tx, "schemaVersion", m.version);
    });
    lastApplied = m.version;
    console.log(`[DB][migrate] applied #${m.version} ${m.name}`);
  }
  return { applied: pending.length, from: current, to: lastApplied };
}

// ─── Auto-sync (additive only): add missing tables/columns/indexes ───────
async function syncSchemaFromTables(adapter) {
  for (const [tableName, def] of Object.entries(TABLES)) {
    // Create table if absent
    await adapter.exec(buildCreateTableSql(tableName, def, adapter.dialect));

    // Diff columns. Compared case-insensitively: Postgres folds unquoted
    // identifiers to lowercase, so `createdAt` is stored as `createdat`.
    const existing = await adapter.listColumns(tableName);
    const existingNames = new Set(existing.map((n) => n.toLowerCase()));
    for (const [colName, colDef] of Object.entries(def.columns)) {
      if (!existingNames.has(colName.toLowerCase())) {
        // SQLite ADD COLUMN restrictions: no PRIMARY KEY / UNIQUE w/o NULL ok.
        // We strip PRIMARY KEY / UNIQUE since those are only valid at create time.
        const safeDef = colDef
          .replace(/PRIMARY KEY( AUTOINCREMENT)?/i, "")
          .replace(/UNIQUE/i, "")
          .trim();
        try {
          await adapter.exec(`ALTER TABLE ${tableName} ADD COLUMN ${colName} ${safeDef}`);
          console.log(`[DB][sync] +column ${tableName}.${colName}`);
        } catch (e) {
          console.warn(`[DB][sync] add column ${tableName}.${colName} failed: ${e.message}`);
        }
      }
    }

    // Indexes (idempotent)
    for (const idx of def.indexes || []) {
      try { await adapter.exec(idx); } catch {}
    }
  }
}

// ─── Legacy JSON import (one-time) ───────────────────────────────────────
// `INSERT OR REPLACE` is SQLite-only; upsertSql() emits the portable form.
const CONN_COLS = ["id", "provider", "authType", "name", "email", "priority", "isActive", "data", "createdAt", "updatedAt"];
const NODE_COLS = ["id", "type", "name", "data", "createdAt", "updatedAt"];
const POOL_COLS = ["id", "isActive", "testStatus", "data", "createdAt", "updatedAt"];
const KEY_COLS = ["id", "key", "name", "machineId", "isActive", "createdAt"];
const COMBO_COLS = ["id", "name", "kind", "models", "createdAt", "updatedAt"];
const KV_COLS = ["scope", "key", "value"];
const DETAIL_COLS = ["id", "timestamp", "provider", "model", "connectionId", "status", "data"];
const KV_UPSERT = upsertSql("kv", KV_COLS, ["scope", "key"]);

async function importLegacyMain(adapter, data) {
  if (!data || typeof data !== "object") return;

  if (data.settings) {
    await adapter.run(`INSERT INTO settings(id, data) VALUES(1, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data`, [stringifyJson(data.settings)]);
  }

  await importWithAssertion(adapter, "providerConnections", data.providerConnections || [], async (c) => {
    const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
    await adapter.run(
      upsertSql("providerConnections", CONN_COLS, ["id"]),
      [id, provider, authType || "oauth", name || null, email || null, priority || null, isActive === false ? 0 : 1, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, provider: c.provider ?? null, name: c.name ?? null }));

  await importWithAssertion(adapter, "providerNodes", data.providerNodes || [], async (n) => {
    const { id, type, name, createdAt, updatedAt, ...rest } = n;
    await adapter.run(
      upsertSql("providerNodes", NODE_COLS, ["id"]),
      [id, type || null, name || null, stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (n) => ({ id: n.id ?? null, type: n.type ?? null, name: n.name ?? null }));

  await importWithAssertion(adapter, "proxyPools", data.proxyPools || [], async (p) => {
    const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
    await adapter.run(
      upsertSql("proxyPools", POOL_COLS, ["id"]),
      [id, isActive === false ? 0 : 1, testStatus || "unknown", stringifyJson(rest), createdAt || new Date().toISOString(), updatedAt || new Date().toISOString()]
    );
  }, (p) => ({ id: p.id ?? null }));

  await importWithAssertion(adapter, "apiKeys", data.apiKeys || [], async (k) => {
    await adapter.run(
      upsertSql("apiKeys", KEY_COLS, ["id"]),
      [k.id, k.key, k.name || null, k.machineId || null, k.isActive === false ? 0 : 1, k.createdAt || new Date().toISOString()]
    );
  }, (k) => ({ id: k.id ?? null, name: k.name ?? null }));

  await importWithAssertion(adapter, "combos", data.combos || [], async (c) => {
    await adapter.run(
      upsertSql("combos", COMBO_COLS, ["id"]),
      [c.id, c.name, c.kind || null, stringifyJson(c.models || []), c.createdAt || new Date().toISOString(), c.updatedAt || new Date().toISOString()]
    );
  }, (c) => ({ id: c.id ?? null, name: c.name ?? null }));

  for (const [alias, model] of Object.entries(data.modelAliases || {})) {
    await adapter.run(KV_UPSERT, ["modelAliases", alias, stringifyJson(model)]);
  }
  for (const m of data.customModels || []) {
    const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
    await adapter.run(KV_UPSERT, ["customModels", k, stringifyJson(m)]);
  }
  for (const [tool, mappings] of Object.entries(data.mitmAlias || {})) {
    await adapter.run(KV_UPSERT, ["mitmAlias", tool, stringifyJson(mappings || {})]);
  }
  for (const [provider, models] of Object.entries(data.pricing || {})) {
    await adapter.run(KV_UPSERT, ["pricing", provider, stringifyJson(models || {})]);
  }
}

async function importLegacyUsage(adapter, data) {
  if (!data || typeof data !== "object") return;
  for (const e of data.history || []) {
    const t = e.tokens || {};
    await adapter.run(
      `INSERT INTO usageHistory(timestamp, provider, model, connectionId, apiKey, endpoint, promptTokens, completionTokens, cost, status, tokens, meta) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        e.timestamp || new Date().toISOString(),
        e.provider || null, e.model || null, e.connectionId || null, e.apiKey || null, e.endpoint || null,
        t.prompt_tokens || t.input_tokens || 0,
        t.completion_tokens || t.output_tokens || 0,
        e.cost || 0,
        e.status || "ok",
        stringifyJson(t),
        stringifyJson({}),
      ]
    );
  }
  for (const [dateKey, day] of Object.entries(data.dailySummary || {})) {
    await adapter.run(upsertSql("usageDaily", ["dateKey", "data"], ["dateKey"]), [dateKey, stringifyJson(day)]);
  }
  if (typeof data.totalRequestsLifetime === "number") {
    await setMetaOn(adapter, "totalRequestsLifetime", data.totalRequestsLifetime);
  }
}

async function importLegacyDisabled(adapter, data) {
  if (!data || typeof data.disabled !== "object") return;
  for (const [provider, ids] of Object.entries(data.disabled)) {
    await adapter.run(KV_UPSERT, ["disabledModels", provider, stringifyJson(ids || [])]);
  }
}

async function importLegacyDetails(adapter, data) {
  if (!data || !Array.isArray(data.records)) return;
  const sql = upsertSql("requestDetails", DETAIL_COLS, ["id"]);
  for (const r of data.records) {
    await adapter.run(sql, [r.id, r.timestamp || new Date().toISOString(), r.provider || null, r.model || null, r.connectionId || null, r.status || null, stringifyJson(r)]);
  }
}

// ─── Main entry ──────────────────────────────────────────────────────────
export async function runMigrationOnce(adapter) {
  if (_migratedAdapters.has(adapter)) return;
  _migratedAdapters.add(adapter);

  // Capture freshness BEFORE migrations stamp _meta (otherwise we'd misclassify
  // a brand-new DB as non-fresh once schemaVersion is written).
  const fresh = await isFreshDb(adapter);

  // Prune stale backups every boot so old oversized backups shrink to KEEP.
  pruneOldBackups();

  // Bootstrap _meta so we can read the stored backup schema version below
  // (runVersionedMigrations also ensures this, but we need it earlier here).
  await adapter.exec(buildCreateTableSql("_meta", TABLES._meta, adapter.dialect));

  // Detect a pending schema change via the central SCHEMA_VERSION const.
  // A lightweight backup is taken BEFORE any schema mutation below.
  const storedSchemaVer = parseInt(await getMetaOn(adapter, "backupSchemaVersion", "0"), 10) || 0;
  const schemaChanging = !fresh && storedSchemaVer < SCHEMA_VERSION;
  if (schemaChanging) {
    try {
      const backupDir = makeBackupDir(`schema-${storedSchemaVer}-to-${SCHEMA_VERSION}`);
      const dest = await backupDbLite(adapter, backupDir);
      pruneOldBackups();
      if (dest) console.log(`[DB][migrate] pre-schema backup ${storedSchemaVer} → ${SCHEMA_VERSION}: ${backupDir}`);
    } catch (e) {
      console.warn(`[DB][migrate] pre-schema backup failed (continuing): ${e.message}`);
    }
  }

  // 1. Always run versioned migrations chain (skip-version safe)
  await runVersionedMigrations(adapter);

  // 2. Additive sync (auto add missing columns/indexes declared in TABLES)
  await syncSchemaFromTables(adapter);

  // Stamp the schema version we just reached so future boots skip re-backup.
  await setMetaOn(adapter, "backupSchemaVersion", SCHEMA_VERSION);

  // 3. One-time legacy JSON import (only if DB was fresh on entry).
  //
  // SQLite only, on purpose: the legacy JSON files are local to one machine.
  // Auto-importing them into a shared Postgres from every instance's first boot
  // is a race, not a migration — and it would resurrect deleted rows and stale
  // credentials. Move a local DB to Postgres explicitly with
  // `node scripts/db-copy-to-postgres.mjs`.
  const localJson = adapter.dialect === "sqlite";
  const alreadyImported = fs.existsSync(MIGRATED_MARKER);
  const legacyMain = localJson ? readJsonSafe(LEGACY_FILES.main) : null;
  const legacyUsage = localJson ? readJsonSafe(LEGACY_FILES.usage) : null;
  const legacyDisabled = localJson ? readJsonSafe(LEGACY_FILES.disabled) : null;
  const legacyDetails = localJson ? readJsonSafe(LEGACY_FILES.details) : null;
  const hasLegacy = !!(legacyMain || legacyUsage || legacyDisabled || legacyDetails);

  if (fresh && hasLegacy && !alreadyImported) {
    const t0 = Date.now();
    const backupDir = makeBackupDir("migrate-from-json");
    for (const f of Object.values(LEGACY_FILES)) backupFile(f, backupDir);

    try {
      await adapter.transaction(async (tx) => {
        await importLegacyMain(tx, legacyMain);
        await importLegacyUsage(tx, legacyUsage);
        await importLegacyDisabled(tx, legacyDisabled);
        await importLegacyDetails(tx, legacyDetails);
        await setMetaOn(tx, "appVersion", getAppVersion());
        await setMetaOn(tx, "backupSchemaVersion", SCHEMA_VERSION);
        await setMetaOn(tx, "migratedAt", new Date().toISOString());
      });
    } catch (err) {
      if (err instanceof MigrationAborted) {
        console.error(`[DB][migrate] aborted: ${err.message} | legacy JSON kept | backup: ${backupDir}`);
        return;
      }
      throw err;
    }

    try { fs.writeFileSync(MIGRATED_MARKER, new Date().toISOString()); } catch {}
    pruneOldBackups();
    console.log(`[DB][migrate] JSON → SQLite in ${Date.now() - t0}ms | legacy JSON kept at DATA_DIR | backup: ${backupDir}`);
    return;
  }

  // Track app version for informational purposes only. App version bumps no
  // longer trigger a DB backup — only real schema changes (SCHEMA_VERSION) do.
  const newVer = getAppVersion();
  const oldVer = await getMetaOn(adapter, "appVersion", null);
  if (oldVer !== newVer) await setMetaOn(adapter, "appVersion", newVer);
}
