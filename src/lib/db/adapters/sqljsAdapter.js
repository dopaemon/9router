import fs from "node:fs";
import initSqlJs from "sql.js";
import { PRAGMA_SQL } from "../schema.js";
import { createSerializer, sqliteListColumns } from "./sqliteShared.js";

let SQL = null;

async function loadSql() {
  if (SQL) return SQL;
  try {
    const inlineMod = await import("sql.js/dist/sql-wasm-inline.js");
    const initFn = inlineMod.default || inlineMod;
    SQL = await initFn();
    return SQL;
  } catch (_) {
    SQL = await initSqlJs();
    return SQL;
  }
}

export async function createSqlJsAdapter(filePath) {
  const SQLLib = await loadSql();
  const buf = fs.existsSync(filePath) ? fs.readFileSync(filePath) : null;
  const db = new SQLLib.Database(buf);
  db.exec(PRAGMA_SQL);
  // Schema is created/synced by migrate.js after adapter init

  let dirty = false;
  let saveTimer = null;
  const SAVE_DEBOUNCE_MS = 100;

  function persist() {
    const data = db.export();
    fs.writeFileSync(filePath, Buffer.from(data));
    dirty = false;
  }

  function scheduleSave() {
    dirty = true;
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      if (dirty) {
        try { persist(); } catch (e) { console.error("[sqljs] save failed:", e); }
      }
    }, SAVE_DEBOUNCE_MS);
  }

  function paramsObj(params) {
    if (!params || (Array.isArray(params) && params.length === 0)) return undefined;
    return params;
  }

  const ser = createSerializer((sql) => db.exec(sql));

  function runRaw(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      stmt.step();
      const changes = db.getRowsModified();
      const lastInsertRowid = db.exec("SELECT last_insert_rowid() as id")[0]?.values?.[0]?.[0] ?? null;
      scheduleSave();
      return { changes, lastInsertRowid };
    } finally {
      stmt.free();
    }
  }

  function getRaw(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      if (stmt.step()) return stmt.getAsObject();
      return undefined;
    } finally {
      stmt.free();
    }
  }

  function allRaw(sql, params = []) {
    const stmt = db.prepare(sql);
    try {
      stmt.bind(paramsObj(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  function execRaw(sql) {
    db.exec(sql);
    scheduleSave();
  }

  const run = (sql, params = []) => ser.op(() => runRaw(sql, params));
  const get = (sql, params = []) => ser.op(() => getRaw(sql, params));
  const all = (sql, params = []) => ser.op(() => allRaw(sql, params));
  const exec = (sql) => ser.op(() => execRaw(sql));

  async function transaction(fn) {
    const r = await ser.transaction(fn, adapter);
    scheduleSave();
    return r;
  }

  function listColumns(table) {
    return sqliteListColumns(all, table);
  }

  function close() {
    if (saveTimer) clearTimeout(saveTimer);
    if (dirty) persist();
  db.close();
  }

  // Security state must reach disk before a logout can acknowledge success.
  function flushNow() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = null;
    if (dirty) persist();
  }

  // Flush on shutdown
  const flush = () => { if (dirty) try { persist(); } catch {} };
  process.on("beforeExit", flush);
  process.on("SIGINT", flush);
  process.on("SIGTERM", flush);

  const adapter = { driver: "sql.js", dialect: "sqlite", run, get, all, exec, transaction, listColumns, flush: flushNow, close, raw: db };
  return adapter;
}
