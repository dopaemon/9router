import { getAdapter } from "../driver.js";

export async function getMeta(key, fallback = null) {
  const db = await getAdapter();
  return getMetaOn(db, key, fallback);
}

export async function setMeta(key, value) {
  const db = await getAdapter();
  return setMetaOn(db, key, value);
}

// Adapter-explicit variants — used during migration (before getAdapter()
// resolves) and inside transactions, where the pinned tx handle must be passed.
export async function getMetaOn(adapter, key, fallback = null) {
  const row = await adapter.get(`SELECT value FROM _meta WHERE key = ?`, [key]);
  return row ? row.value : fallback;
}

export async function setMetaOn(adapter, key, value) {
  await adapter.run(
    `INSERT INTO _meta(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, String(value)]
  );
}
