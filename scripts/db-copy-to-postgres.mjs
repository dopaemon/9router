#!/usr/bin/env node
// One-time copy of the local SQLite DB into Postgres / Supabase.
//
//   SUPABASE_DB_URL='postgresql://postgres:...@...pooler.supabase.com:6543/postgres' \
//     node scripts/db-copy-to-postgres.mjs [--dry-run] [--skip-observability]
//
// Idempotent: rows are upserted on their primary key, so a re-run tops up a
// partial copy instead of duplicating. It never deletes from the destination —
// rows that exist only in Postgres are left alone.
//
// Credentials (OAuth refresh tokens, API keys) are copied verbatim. The
// destination is a remote database: make sure it is private (Supabase: keep
// these tables RLS-on and reach them only via this server's service
// credentials, never the anon key).
import process from "node:process";
import { TABLES } from "../src/lib/db/schema.js";
import { upsertSql } from "../src/lib/db/sqlDialect.js";
import { DATA_FILE } from "../src/lib/db/paths.js";

const dryRun = process.argv.includes("--dry-run");
const skipObservability = process.argv.includes("--skip-observability");
const BATCH = 500;

// Observability tables are large and reproducible — usually not worth the copy.
const OBSERVABILITY = new Set(["requestDetails", "usageHistory"]);

function primaryKeyOf(name, def) {
  if (def.primaryKey) {
    const m = def.primaryKey.match(/PRIMARY KEY\s*\(([^)]+)\)/i);
    if (m) return m[1].split(",").map((s) => s.trim());
  }
  const pk = Object.entries(def.columns).find(([, t]) => /PRIMARY KEY/i.test(t));
  if (!pk) throw new Error(`${name}: no primary key in schema — cannot upsert safely`);
  return [pk[0]];
}

async function main() {
  const url = (process.env.SUPABASE_DB_URL || process.env.DATABASE_URL || "").trim();
  if (!url) {
    console.error("Set SUPABASE_DB_URL (or DATABASE_URL) to the destination Postgres connection string.");
    process.exit(1);
  }

  // Source: the local SQLite file, opened directly so the env var pointing at
  // Postgres doesn't hijack it.
  const { createNodeSqliteAdapter } = await import("../src/lib/db/adapters/nodeSqliteAdapter.js");
  const src = await createNodeSqliteAdapter(DATA_FILE);
  console.log(`source : ${DATA_FILE}`);

  const { createPostgresAdapter } = await import("../src/lib/db/adapters/postgresAdapter.js");
  const dest = await createPostgresAdapter(url);
  console.log(`dest   : ${new URL(url).hostname}`);

  // Create the schema on the destination before copying into it.
  const { runMigrationOnce } = await import("../src/lib/db/migrate.js");
  await runMigrationOnce(dest);

  let total = 0;
  for (const [table, def] of Object.entries(TABLES)) {
    if (table === "_meta") continue; // migration bookkeeping, destination owns it
    if (skipObservability && OBSERVABILITY.has(table)) {
      console.log(`${table.padEnd(22)} skipped (--skip-observability)`);
      continue;
    }

    const cols = Object.keys(def.columns);
    const pk = primaryKeyOf(table, def);
    const sql = upsertSql(table, cols, pk);

    let rows;
    try { rows = await src.all(`SELECT ${cols.join(", ")} FROM ${table}`); }
    catch (e) { console.log(`${table.padEnd(22)} skipped (${e.message})`); continue; }

    if (!rows.length) { console.log(`${table.padEnd(22)} 0 rows`); continue; }
    if (dryRun) { console.log(`${table.padEnd(22)} ${rows.length} rows (dry run)`); total += rows.length; continue; }

    for (let i = 0; i < rows.length; i += BATCH) {
      const batch = rows.slice(i, i + BATCH);
      // One transaction per batch: a failure rolls back only that batch, and the
      // re-run picks up where it stopped because the inserts are upserts.
      await dest.transaction(async (tx) => {
        for (const r of batch) await tx.run(sql, cols.map((c) => r[c] ?? null));
      });
    }
    console.log(`${table.padEnd(22)} ${rows.length} rows copied`);
    total += rows.length;
  }

  // usageHistory.id is an identity column; explicit ids above don't advance its
  // sequence, so the next app insert would collide. Fast-forward it.
  if (!dryRun && !skipObservability) {
    await dest.exec(
      `SELECT setval(pg_get_serial_sequence('usagehistory', 'id'), COALESCE((SELECT MAX(id) FROM usageHistory), 0) + 1, false)`
    );
  }

  console.log(`\n${dryRun ? "would copy" : "copied"} ${total} rows`);
  console.log("Next: set SUPABASE_DB_URL in the server's environment and restart it.");
  src.close();
  await dest.close();
}

main().catch((e) => { console.error(e); process.exit(1); });
