// Postgres / Supabase adapter. Selected when SUPABASE_DB_URL (or DATABASE_URL)
// is set — see driver.js. Unlike the SQLite adapters every method is async,
// which is why repos await every adapter call.
//
// Supabase: use the *pooler* connection string (port 6543, pgbouncer) for a
// long-running server. Direct port 5432 works too but caps connections low.
import { toPgSql, canonicalizeRow } from "../sqlDialect.js";

const DEFAULT_POOL_MAX = 10;

export async function createPostgresAdapter(connectionString) {
  // Dynamic import so the pg dep is only required when actually using Postgres.
  const pg = await import("pg");
  const Pool = pg.default?.Pool || pg.Pool;

  // TLS on by default with verification — Supabase hostnames carry publicly
  // trusted certs. PGSSL_NO_VERIFY=1 is the escape hatch for self-hosted
  // Postgres behind a private CA; it disables MITM protection, so only set it
  // on a trusted network.
  const ssl = /\bsslmode=disable\b/.test(connectionString)
    ? false
    : { rejectUnauthorized: process.env.PGSSL_NO_VERIFY !== "1" };

  async function resolvePoolWithFallback() {
    const p = new Pool({
      connectionString,
      ssl,
      max: Number(process.env.PGPOOL_MAX) || DEFAULT_POOL_MAX,
      statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 15000,
      connectionTimeoutMillis: 5000,
    });

    try {
      const probe = await p.connect();
      probe.release();
      return p;
    } catch (err) {
      await p.end().catch(() => {});

      // Supabase direct host (db.<ref>.supabase.co) only exposes IPv6 (AAAA).
      // On IPv4-only networks (most VPS/containers), dns.lookup fails with ENOTFOUND.
      // Auto-fallback to the IPv4-compatible transaction pooler (port 6543).
      let parsed;
      try { parsed = new URL(connectionString); } catch {}
      const m = parsed?.hostname?.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
      if (m && (err.code === "ENOTFOUND" || err.code === "ETIMEDOUT" || err.message?.includes("ENOTFOUND"))) {
        const ref = m[1];
        const regions = [
          "ap-southeast-1", "us-east-1", "eu-central-1", "ap-southeast-2",
          "us-west-1", "eu-west-1", "sa-east-1", "ap-northeast-1", "ap-south-1"
        ];
        for (const reg of regions) {
          const poolerHost = `aws-0-${reg}.pooler.supabase.com`;
          const testUrl = new URL(connectionString);
          testUrl.hostname = poolerHost;
          testUrl.port = "6543";
          testUrl.username = testUrl.username.includes(".") ? testUrl.username : `${testUrl.username}.${ref}`;

          const fallbackPool = new Pool({
            connectionString: testUrl.toString(),
            ssl,
            max: Number(process.env.PGPOOL_MAX) || DEFAULT_POOL_MAX,
            statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 15000,
            connectionTimeoutMillis: 3000,
          });
          try {
            const client = await fallbackPool.connect();
            client.release();
            console.warn(`[DB] Supabase direct host has no IPv4 in this network. Automatically routed via transaction pooler: ${poolerHost}:6543`);
            return fallbackPool;
          } catch {
            await fallbackPool.end().catch(() => {});
          }
        }
      }
      throw err;
    }
  }

  const pool = await resolvePoolWithFallback();

  const query = async (client, sql, params) => {
    const r = await client.query(toPgSql(sql), params);
    return r;
  };

  // run/get/all/exec bound to a specific client (a pooled one, or the dedicated
  // client held open for the duration of a transaction).
  function ops(client) {
    return {
      async run(sql, params = []) {
        const r = await query(client, sql, params);
        return { changes: r.rowCount ?? 0, lastInsertRowid: 0 };
      },
      async get(sql, params = []) {
        const r = await query(client, sql, params);
        return canonicalizeRow(r.rows[0]);
      },
      async all(sql, params = []) {
        const r = await query(client, sql, params);
        return r.rows.map(canonicalizeRow);
      },
      async exec(sql) {
        // Multi-statement DDL blocks arrive here; pg's simple query handles them.
        await client.query(sql);
      },
    };
  }

  async function withClient(fn) {
    const client = await pool.connect();
    try { return await fn(client); } finally { client.release(); }
  }

  const adapter = {
    driver: "postgres",
    dialect: "postgres",
    run: (sql, params = []) => withClient((c) => ops(c).run(sql, params)),
    get: (sql, params = []) => withClient((c) => ops(c).get(sql, params)),
    all: (sql, params = []) => withClient((c) => ops(c).all(sql, params)),
    exec: (sql) => withClient((c) => ops(c).exec(sql)),

    // The callback receives a tx handle pinned to one client. Statements issued
    // on the outer adapter inside the callback would take a *different*
    // connection and fall outside the transaction, so always use the argument.
    async transaction(fn) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        const r = await fn(ops(client));
        await client.query("COMMIT");
        return r;
      } catch (e) {
        try { await client.query("ROLLBACK"); } catch {}
        throw e;
      } finally {
        client.release();
      }
    },

    async listColumns(table) {
      const rows = await adapter.all(
        `SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = ?`,
        [table.toLowerCase()]
      );
      return rows.map((r) => r.column_name);
    },

    checkpoint() {},
    async close() { await pool.end(); },
    raw: pool,
  };

  return adapter;
}
