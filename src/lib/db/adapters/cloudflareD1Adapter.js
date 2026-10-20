// Cloudflare D1 adapter over Cloudflare REST API.
// Selected when CF_D1=true (or CF_D1=1) and D1 credentials are set.
// D1 speaks standard SQLite SQL, so dialect is 'sqlite'.
import { AsyncLocalStorage } from "node:async_hooks";
import { sqliteListColumns } from "./sqliteShared.js";

function normalizeParam(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "boolean") return v ? 1 : 0;
  return v;
}

function createD1Serializer() {
  let tail = Promise.resolve();
  const inTx = new AsyncLocalStorage();

  function chain(job) {
    const run = () => job();
    const p = tail.then(run, run);
    tail = p.then(() => {}, () => {});
    return p;
  }

  return {
    op(job) {
      return inTx.getStore() ? job() : chain(job);
    },
    transaction(fn, handle) {
      if (inTx.getStore()) return fn(handle);
      return chain(() => inTx.run(true, () => fn(handle)));
    },
  };
}

export function createCloudflareD1Adapter({ accountId, databaseId, apiToken, timeoutMs = 15000 }) {
  if (!accountId || !databaseId || !apiToken) {
    throw new Error("[DB] Cloudflare D1 requires accountId, databaseId, and apiToken");
  }

  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/d1/database/${databaseId}/query`;
  const ser = createD1Serializer();

  async function executeRaw(payload) {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiToken}`,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.success) {
      const errMsg = body?.errors?.[0]?.message || (typeof body === "object" ? JSON.stringify(body) : `HTTP ${res.status}`);
      throw new Error(`[DB][D1] Query failed: ${errMsg}`);
    }
    return body.result;
  }

  async function querySingle(sql, params = []) {
    const cleanSql = sql.trim();
    if (!cleanSql) return { results: [], meta: {} };

    const payload = {
      sql: cleanSql,
      params: params.map(normalizeParam),
    };
    const result = await executeRaw(payload);
    const first = Array.isArray(result) ? result[0] : result;
    return {
      results: first?.results || [],
      meta: first?.meta || {},
    };
  }

  const adapter = {
    driver: "cloudflare-d1",
    dialect: "sqlite",

    run(sql, params = []) {
      return ser.op(async () => {
        const { meta } = await querySingle(sql, params);
        return {
          changes: Number(meta.changes ?? 0),
          lastInsertRowid: Number(meta.last_row_id ?? 0),
        };
      });
    },

    get(sql, params = []) {
      return ser.op(async () => {
        const { results } = await querySingle(sql, params);
        return results[0] || null;
      });
    },

    all(sql, params = []) {
      return ser.op(async () => {
        const { results } = await querySingle(sql, params);
        return results || [];
      });
    },

    exec(sql) {
      return ser.op(async () => {
        const clean = sql.trim();
        if (!clean) return;
        await executeRaw({ sql: clean });
      });
    },

    transaction(fn) {
      return ser.transaction(fn, adapter);
    },

    listColumns(table) {
      return sqliteListColumns((s) => adapter.all(s), table);
    },

    checkpoint() {},
    close() {},
    raw: { endpoint, accountId, databaseId },
  };

  return adapter;
}
