import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { PRAGMA_SQL, TABLES, buildCreateTableSql } from "../schema.js";
import { stringifyJson, parseJson } from "./jsonCol.js";
import { keyAccessToColumns, keyAccessFromColumns } from "../../../shared/utils/keyAccess.js";
import { KEY_ACCESS_UNRESTRICTED } from "../../../shared/constants/keyAccess.js";

let SQL_LIB = null;

async function getSqlJsLib() {
  if (SQL_LIB) return SQL_LIB;

  // 1. Try inline wasm first (zero external file dependency, works anywhere)
  try {
    const inlineMod = await import("sql.js/dist/sql-wasm-inline.js");
    const initFn = inlineMod.default || inlineMod;
    SQL_LIB = await initFn();
    return SQL_LIB;
  } catch (_) {}

  // 2. Try standard sql.js with locateFile looking in known runtime locations
  try {
    const standardMod = await import("sql.js");
    const initFn = standardMod.default || standardMod;

    const candidateDirs = [
      path.join(os.homedir(), ".9router", "runtime", "node_modules", "sql.js", "dist"),
      path.join(process.cwd(), "node_modules", "sql.js", "dist"),
      path.join(process.cwd(), "app", "node_modules", "sql.js", "dist"),
    ];

    let foundWasmDir = null;
    for (const dir of candidateDirs) {
      if (fs.existsSync(path.join(dir, "sql-wasm.wasm"))) {
        foundWasmDir = dir;
        break;
      }
    }

    const opts = foundWasmDir
      ? { locateFile: (file) => path.join(foundWasmDir, file) }
      : {};

    SQL_LIB = await initFn(opts);
    return SQL_LIB;
  } catch (err) {
    throw new Error(`Failed to initialize SQLite fallback: ${err.message}`);
  }
}

/**
 * Builds a binary SQLite buffer from standard JSON database payload.
 * Uses native node:sqlite when available, with fallback to sql.js.
 *
 * @param {Object} payload Database export payload
 * @returns {Promise<Buffer>} SQLite database binary buffer
 */
export async function exportDbToSqliteBuffer(payload) {
  if (!payload || typeof payload !== "object") {
    throw new Error("Invalid payload for SQLite export");
  }

  // Attempt 1: Native node:sqlite (Node 22.5+, native C code, fast and no wasm needed)
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const tmpPath = path.join(
      os.tmpdir(),
      `9r-export-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );

    try {
      const db = new DatabaseSync(tmpPath);
      db.exec(PRAGMA_SQL);

      for (const [name, def] of Object.entries(TABLES)) {
        db.exec(buildCreateTableSql(name, def, "sqlite"));
      }

      if (payload.settings) {
        db.prepare("INSERT INTO settings(id, data) VALUES(1, ?)").run(stringifyJson(payload.settings));
      }

      const insertConn = db.prepare(
        `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const c of payload.providerConnections || []) {
        const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
        insertConn.run(
          id,
          provider,
          authType || "oauth",
          name || null,
          email || null,
          priority || null,
          isActive === false ? 0 : 1,
          stringifyJson(rest),
          createdAt || new Date().toISOString(),
          updatedAt || new Date().toISOString()
        );
      }

      const insertNode = db.prepare(
        `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`
      );
      for (const n of payload.providerNodes || []) {
        const { id, type, name, createdAt, updatedAt, ...rest } = n;
        insertNode.run(
          id,
          type || null,
          name || null,
          stringifyJson(rest),
          createdAt || new Date().toISOString(),
          updatedAt || new Date().toISOString()
        );
      }

      const insertPool = db.prepare(
        `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`
      );
      for (const p of payload.proxyPools || []) {
        const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
        insertPool.run(
          id,
          isActive === false ? 0 : 1,
          testStatus || "unknown",
          stringifyJson(rest),
          createdAt || new Date().toISOString(),
          updatedAt || new Date().toISOString()
        );
      }

      const insertKey = db.prepare(
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`
      );
      for (const k of payload.apiKeys || []) {
        const access = k.access || KEY_ACCESS_UNRESTRICTED;
        const cols = keyAccessToColumns(access);
        insertKey.run(
          k.id,
          k.key,
          k.name || null,
          k.machineId || null,
          k.isActive === false ? 0 : 1,
          k.createdAt || new Date().toISOString(),
          cols.accessRestricted,
          cols.accessAllow
        );
      }

      const insertCombo = db.prepare(
        `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`
      );
      for (const c of payload.combos || []) {
        insertCombo.run(
          c.id,
          c.name,
          c.kind || null,
          stringifyJson(c.models || []),
          c.createdAt || new Date().toISOString(),
          c.updatedAt || new Date().toISOString()
        );
      }

      const insertKv = db.prepare(`INSERT INTO kv(scope, key, value) VALUES(?, ?, ?)`);
      for (const [a, m] of Object.entries(payload.modelAliases || {})) {
        insertKv.run("modelAliases", a, stringifyJson(m));
      }
      for (const m of payload.customModels || []) {
        const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
        insertKv.run("customModels", k, stringifyJson(m));
      }
      for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
        insertKv.run("mitmAlias", tool, stringifyJson(mappings || {}));
      }
      for (const [provider, models] of Object.entries(payload.pricing || {})) {
        insertKv.run("pricing", provider, stringifyJson(models || {}));
      }
      for (const [provider, models] of Object.entries(payload.disabledModels || {})) {
        insertKv.run("disabledModels", provider, stringifyJson(models || []));
      }

      db.close();
      const buffer = fs.readFileSync(tmpPath);
      return buffer;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  } catch (_) {
    // Fallback: sql.js
  }

  // Attempt 2: sql.js (pure JS / WebAssembly)
  const SQL = await getSqlJsLib();
  const db = new SQL.Database();

  try {
    db.exec(PRAGMA_SQL);

    for (const [name, def] of Object.entries(TABLES)) {
      db.exec(buildCreateTableSql(name, def, "sqlite"));
    }

    if (payload.settings) {
      db.run("INSERT INTO settings(id, data) VALUES(1, ?)", [stringifyJson(payload.settings)]);
    }

    for (const c of payload.providerConnections || []) {
      const { id, provider, authType, name, email, priority, isActive, createdAt, updatedAt, ...rest } = c;
      db.run(
        `INSERT INTO providerConnections(id, provider, authType, name, email, priority, isActive, data, createdAt, updatedAt)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          provider,
          authType || "oauth",
          name || null,
          email || null,
          priority || null,
          isActive === false ? 0 : 1,
          stringifyJson(rest),
          createdAt || new Date().toISOString(),
          updatedAt || new Date().toISOString(),
        ]
      );
    }

    for (const n of payload.providerNodes || []) {
      const { id, type, name, createdAt, updatedAt, ...rest } = n;
      db.run(
        `INSERT INTO providerNodes(id, type, name, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [
          id,
          type || null,
          name || null,
          stringifyJson(rest),
          createdAt || new Date().toISOString(),
          updatedAt || new Date().toISOString(),
        ]
      );
    }

    for (const p of payload.proxyPools || []) {
      const { id, isActive, testStatus, createdAt, updatedAt, ...rest } = p;
      db.run(
        `INSERT INTO proxyPools(id, isActive, testStatus, data, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [
          id,
          isActive === false ? 0 : 1,
          testStatus || "unknown",
          stringifyJson(rest),
          createdAt || new Date().toISOString(),
          updatedAt || new Date().toISOString(),
        ]
      );
    }

    for (const k of payload.apiKeys || []) {
      const access = k.access || KEY_ACCESS_UNRESTRICTED;
      const cols = keyAccessToColumns(access);
      db.run(
        `INSERT INTO apiKeys(id, key, name, machineId, isActive, createdAt, accessRestricted, accessAllow)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          k.id,
          k.key,
          k.name || null,
          k.machineId || null,
          k.isActive === false ? 0 : 1,
          k.createdAt || new Date().toISOString(),
          cols.accessRestricted,
          cols.accessAllow,
        ]
      );
    }

    for (const c of payload.combos || []) {
      db.run(
        `INSERT INTO combos(id, name, kind, models, createdAt, updatedAt) VALUES(?, ?, ?, ?, ?, ?)`,
        [
          c.id,
          c.name,
          c.kind || null,
          stringifyJson(c.models || []),
          c.createdAt || new Date().toISOString(),
          c.updatedAt || new Date().toISOString(),
        ]
      );
    }

    for (const [a, m] of Object.entries(payload.modelAliases || {})) {
      db.run(`INSERT INTO kv(scope, key, value) VALUES('modelAliases', ?, ?)`, [a, stringifyJson(m)]);
    }
    for (const m of payload.customModels || []) {
      const k = `${m.providerAlias}|${m.id}|${m.type || "llm"}`;
      db.run(`INSERT INTO kv(scope, key, value) VALUES('customModels', ?, ?)`, [k, stringifyJson(m)]);
    }
    for (const [tool, mappings] of Object.entries(payload.mitmAlias || {})) {
      db.run(`INSERT INTO kv(scope, key, value) VALUES('mitmAlias', ?, ?)`, [tool, stringifyJson(mappings || {})]);
    }
    for (const [provider, models] of Object.entries(payload.pricing || {})) {
      db.run(`INSERT INTO kv(scope, key, value) VALUES('pricing', ?, ?)`, [provider, stringifyJson(models || {})]);
    }
    for (const [provider, models] of Object.entries(payload.disabledModels || {})) {
      db.run(`INSERT INTO kv(scope, key, value) VALUES('disabledModels', ?, ?)`, [provider, stringifyJson(models || [])]);
    }

    const exportedBytes = db.export();
    return Buffer.from(exportedBytes);
  } finally {
    db.close();
  }
}

/**
 * Extracts standard JSON database payload from a SQLite binary buffer.
 * Uses native node:sqlite when available, with fallback to sql.js.
 *
 * @param {Buffer|Uint8Array} sqliteBuffer
 * @returns {Promise<Object>} Database export payload
 */
export async function extractPayloadFromSqliteBuffer(sqliteBuffer) {
  if (!sqliteBuffer || sqliteBuffer.length < 16) {
    throw new Error("Invalid SQLite file: file is empty or too small");
  }

  const u8 = sqliteBuffer instanceof Uint8Array ? sqliteBuffer : new Uint8Array(sqliteBuffer);
  const header = Buffer.from(u8.subarray(0, 16)).toString("utf8");
  if (!header.startsWith("SQLite format 3")) {
    throw new Error("Invalid file format: not a SQLite database file");
  }

  // Attempt 1: Native node:sqlite (Node 22.5+, native C code, fast and no wasm needed)
  try {
    const { DatabaseSync } = await import("node:sqlite");
    const tmpPath = path.join(
      os.tmpdir(),
      `9r-import-${Date.now()}-${Math.random().toString(36).slice(2)}.sqlite`
    );
    fs.writeFileSync(tmpPath, u8);

    try {
      const db = new DatabaseSync(tmpPath);

      function hasTable(tableName) {
        try {
          const row = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = ?").get(tableName);
          return Boolean(row);
        } catch (_) {
          return false;
        }
      }

      function queryRows(sql) {
        try {
          return db.prepare(sql).all();
        } catch (e) {
          console.warn("[DB][extractSqlite] query failed:", sql, e.message);
          return [];
        }
      }

      const out = {
        settings: {},
        providerConnections: [],
        providerNodes: [],
        proxyPools: [],
        apiKeys: [],
        combos: [],
        modelAliases: {},
        customModels: [],
        mitmAlias: {},
        pricing: {},
        disabledModels: {},
      };

      if (hasTable("settings")) {
        const rows = queryRows("SELECT data FROM settings WHERE id = 1");
        if (rows.length > 0 && rows[0].data) {
          out.settings = parseJson(rows[0].data, {}) || {};
        }
      }

      if (hasTable("providerConnections")) {
        const rows = queryRows("SELECT * FROM providerConnections");
        out.providerConnections = rows.map((r) => {
          const extra = parseJson(r.data, {}) || {};
          return {
            ...extra,
            id: r.id,
            provider: r.provider,
            authType: r.authType,
            name: r.name,
            email: r.email,
            priority: r.priority,
            isActive: r.isActive === 1 || r.isActive === true || r.isActive === "1",
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          };
        });
      }

      if (hasTable("providerNodes")) {
        const rows = queryRows("SELECT * FROM providerNodes");
        out.providerNodes = rows.map((r) => {
          const extra = parseJson(r.data, {}) || {};
          return {
            ...extra,
            id: r.id,
            type: r.type,
            name: r.name,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          };
        });
      }

      if (hasTable("proxyPools")) {
        const rows = queryRows("SELECT * FROM proxyPools");
        out.proxyPools = rows.map((r) => {
          const extra = parseJson(r.data, {}) || {};
          return {
            ...extra,
            id: r.id,
            isActive: r.isActive === 1 || r.isActive === true || r.isActive === "1",
            testStatus: r.testStatus,
            createdAt: r.createdAt,
            updatedAt: r.updatedAt,
          };
        });
      }

      if (hasTable("apiKeys")) {
        const rows = queryRows("SELECT * FROM apiKeys");
        out.apiKeys = rows.map((r) => ({
          id: r.id,
          key: r.key,
          name: r.name,
          machineId: r.machineId,
          isActive: r.isActive === 1 || r.isActive === true || r.isActive === "1",
          createdAt: r.createdAt,
          access: keyAccessFromColumns(r.accessRestricted, r.accessAllow),
        }));
      }

      if (hasTable("combos")) {
        const rows = queryRows("SELECT * FROM combos");
        out.combos = rows.map((r) => ({
          id: r.id,
          name: r.name,
          kind: r.kind,
          models: parseJson(r.models, []) || [],
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        }));
      }

      if (hasTable("kv")) {
        const rows = queryRows("SELECT scope, key, value FROM kv");
        for (const r of rows) {
          const val = parseJson(r.value);
          if (r.scope === "modelAliases") {
            out.modelAliases[r.key] = val;
          } else if (r.scope === "customModels") {
            if (val) out.customModels.push(val);
          } else if (r.scope === "mitmAlias") {
            out.mitmAlias[r.key] = val;
          } else if (r.scope === "pricing") {
            out.pricing[r.key] = val;
          } else if (r.scope === "disabledModels") {
            out.disabledModels[r.key] = Array.isArray(val) ? val : [];
          }
        }
      }

      db.close();
      return out;
    } finally {
      try { fs.unlinkSync(tmpPath); } catch (_) {}
    }
  } catch (_) {
    // Fallback: sql.js
  }

  // Attempt 2: sql.js (pure JS / WebAssembly)
  const SQL = await getSqlJsLib();
  const db = new SQL.Database(u8);

  function tableExists(tableName) {
    try {
      const stmt = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name = :name");
      stmt.bind({ ":name": tableName });
      const exists = stmt.step();
      stmt.free();
      return exists;
    } catch {
      return false;
    }
  }

  function queryAll(sql, params = {}) {
    const results = [];
    try {
      const stmt = db.prepare(sql);
      if (params && Object.keys(params).length > 0) stmt.bind(params);
      while (stmt.step()) {
        results.push(stmt.getAsObject());
      }
      stmt.free();
    } catch (e) {
      console.warn("[DB][extractSqlite] query failed:", sql, e.message);
    }
    return results;
  }

  try {
    const out = {
      settings: {},
      providerConnections: [],
      providerNodes: [],
      proxyPools: [],
      apiKeys: [],
      combos: [],
      modelAliases: {},
      customModels: [],
      mitmAlias: {},
      pricing: {},
      disabledModels: {},
    };

    if (tableExists("settings")) {
      const rows = queryAll("SELECT data FROM settings WHERE id = 1");
      if (rows.length > 0 && rows[0].data) {
        out.settings = parseJson(rows[0].data, {}) || {};
      }
    }

    if (tableExists("providerConnections")) {
      const rows = queryAll("SELECT * FROM providerConnections");
      out.providerConnections = rows.map((r) => {
        const extra = parseJson(r.data, {}) || {};
        return {
          ...extra,
          id: r.id,
          provider: r.provider,
          authType: r.authType,
          name: r.name,
          email: r.email,
          priority: r.priority,
          isActive: r.isActive === 1 || r.isActive === true || r.isActive === "1",
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      });
    }

    if (tableExists("providerNodes")) {
      const rows = queryAll("SELECT * FROM providerNodes");
      out.providerNodes = rows.map((r) => {
        const extra = parseJson(r.data, {}) || {};
        return {
          ...extra,
          id: r.id,
          type: r.type,
          name: r.name,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      });
    }

    if (tableExists("proxyPools")) {
      const rows = queryAll("SELECT * FROM proxyPools");
      out.proxyPools = rows.map((r) => {
        const extra = parseJson(r.data, {}) || {};
        return {
          ...extra,
          id: r.id,
          isActive: r.isActive === 1 || r.isActive === true || r.isActive === "1",
          testStatus: r.testStatus,
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
        };
      });
    }

    if (tableExists("apiKeys")) {
      const rows = queryAll("SELECT * FROM apiKeys");
      out.apiKeys = rows.map((r) => ({
        id: r.id,
        key: r.key,
        name: r.name,
        machineId: r.machineId,
        isActive: r.isActive === 1 || r.isActive === true || r.isActive === "1",
        createdAt: r.createdAt,
        access: keyAccessFromColumns(r.accessRestricted, r.accessAllow),
      }));
    }

    if (tableExists("combos")) {
      const rows = queryAll("SELECT * FROM combos");
      out.combos = rows.map((r) => ({
        id: r.id,
        name: r.name,
        kind: r.kind,
        models: parseJson(r.models, []) || [],
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
    }

    if (tableExists("kv")) {
      const rows = queryAll("SELECT scope, key, value FROM kv");
      for (const r of rows) {
        const val = parseJson(r.value);
        if (r.scope === "modelAliases") {
          out.modelAliases[r.key] = val;
        } else if (r.scope === "customModels") {
          if (val) out.customModels.push(val);
        } else if (r.scope === "mitmAlias") {
          out.mitmAlias[r.key] = val;
        } else if (r.scope === "pricing") {
          out.pricing[r.key] = val;
        } else if (r.scope === "disabledModels") {
          out.disabledModels[r.key] = Array.isArray(val) ? val : [];
        }
      }
    }

    return out;
  } finally {
    db.close();
  }
}
