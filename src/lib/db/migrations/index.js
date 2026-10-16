// Migration registry — append new entries when schema changes.
// Each migration: { version, name, async up(db, dialect) } — db is a tx handle
// Versions MUST be unique and monotonically increasing.
import m001 from "./001-initial.js";

export const MIGRATIONS = [m001].sort((a, b) => a.version - b.version);

export function latestVersion() {
  return MIGRATIONS.length ? MIGRATIONS[MIGRATIONS.length - 1].version : 0;
}
