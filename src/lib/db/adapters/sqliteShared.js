// Shared bits for the SQLite adapters (bun:sqlite, better-sqlite3, node:sqlite,
// sql.js). The Postgres adapter implements the same contract its own way.
import { AsyncLocalStorage } from "node:async_hooks";

// Async transaction over SAVEPOINT. The driver-native transaction() wrappers
// (better-sqlite3, bun:sqlite) reject async callbacks, and the adapter contract
// is async so the Postgres adapter can honour it — hence SAVEPOINT everywhere.
async function savepointTx(exec, fn, handle) {
  const sp = `sp_${Math.random().toString(36).slice(2)}`;
  exec(`SAVEPOINT ${sp}`);
  try {
    const r = await fn(handle);
    exec(`RELEASE ${sp}`);
    return r;
  } catch (e) {
    try { exec(`ROLLBACK TO ${sp}`); exec(`RELEASE ${sp}`); } catch {}
    throw e;
  }
}

// All four SQLite adapters share ONE connection, so an `await` inside a
// transaction callback hands the event loop to whoever else wants to write.
// Without this serializer two overlapping transactions interleave their
// SAVEPOINTs ("no such savepoint") and a rollback discards an unrelated
// writer's rows. Statements issued from inside the transaction run straight
// through — they are the ones that belong in it.
//
// Postgres doesn't need any of this: each transaction gets its own pooled
// client, so the database does the isolation.
export function createSerializer(exec) {
  let tail = Promise.resolve();
  const inTx = new AsyncLocalStorage();

  function chain(job) {
    const run = () => job();
    const p = tail.then(run, run);
    // Swallow rejection on the chain itself so one failure doesn't poison the
    // queue; the caller still receives the original rejection via `p`.
    tail = p.then(() => {}, () => {});
    return p;
  }

  return {
    // A single statement.
    op(job) {
      return inTx.getStore() ? job() : chain(job);
    },
    // fn receives the handle to issue its statements on.
    transaction(fn, handle) {
      if (inTx.getStore()) return savepointTx(exec, fn, handle); // nested → plain savepoint
      return chain(() => inTx.run(true, () => savepointTx(exec, fn, handle)));
    },
  };
}

// Column introspection — Postgres uses information_schema instead.
export async function sqliteListColumns(all, table) {
  return (await all(`PRAGMA table_info(${table})`)).map((r) => r.name);
}
