// Supabase KeepAlive Background Cron
// Periodically executes real SQL read & write queries on the Postgres / Supabase
// instance so Supabase's compute watchdog registers genuine database activity
// and does not pause/sleep the project after 7 days.
import { getAdapter } from "@/lib/db/driver.js";
import { getSettings, updateSettings } from "@/lib/db/repos/settingsRepo.js";

const g = (global.__supabaseKeepAlive ??= {
  timer: null,
  running: false,
  lastPingAt: null,
  lastStatus: null,
});

/**
 * Executes a real database query against Supabase.
 * Performs both a SELECT and an upsert into `_meta` to generate genuine WAL/IO activity.
 */
export async function runSupabaseKeepAlivePing() {
  const adapter = await getAdapter();
  if (!adapter || adapter.dialect !== "postgres") {
    return {
      skipped: true,
      reason: "Active database driver is not PostgreSQL / Supabase",
    };
  }

  const now = new Date().toISOString();
  // 1. Read query touching Postgres engine
  const serverTimeRow = await adapter.get(
    "SELECT NOW() as server_time, current_database() as db_name, version() as pg_version"
  );

  // 2. Write query into _meta table creating genuine transaction activity
  await adapter.run(
    "INSERT INTO _meta(key, value) VALUES('supabase_last_keepalive', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [now]
  );

  g.lastPingAt = now;
  g.lastStatus = "success";

  try {
    await updateSettings({
      supabaseKeepAliveLastPingAt: now,
      supabaseKeepAliveLastStatus: "success",
    });
  } catch (err) {
    // Non-fatal if settings update fails during maintenance
  }

  return {
    success: true,
    pingedAt: now,
    serverTime: serverTimeRow?.server_time || now,
    database: serverTimeRow?.db_name,
  };
}

export async function checkAndRunKeepAlive() {
  if (g.running) return;
  try {
    g.running = true;
    const settings = await getSettings();
    if (settings.supabaseKeepAliveEnabled === false) return;

    const res = await runSupabaseKeepAlivePing();
    if (res.success) {
      console.log(`[DB][SupabaseKeepAlive] Ping successful at ${res.pingedAt} (DB: ${res.database || "supabase"})`);
    }
  } catch (err) {
    console.warn(`[DB][SupabaseKeepAlive] Ping failed: ${err.message}`);
    g.lastStatus = `error: ${err.message}`;
    try {
      await updateSettings({
        supabaseKeepAliveLastStatus: `error: ${err.message}`,
      });
    } catch {}
  } finally {
    g.running = false;
  }
}

export async function startSupabaseKeepAlive() {
  stopSupabaseKeepAlive();

  try {
    const settings = await getSettings();
    if (settings.supabaseKeepAliveEnabled === false) {
      console.log("[DB][SupabaseKeepAlive] Disabled in settings.");
      return;
    }

    const intervalMinutes = Math.max(5, Number(settings.supabaseKeepAliveIntervalMinutes) || 60);
    const intervalMs = intervalMinutes * 60 * 1000;

    // Run first check soon after boot (10 seconds delay)
    setTimeout(() => {
      checkAndRunKeepAlive().catch(() => {});
    }, 10000);

    // Schedule recurring interval
    g.timer = setInterval(() => {
      checkAndRunKeepAlive().catch(() => {});
    }, intervalMs);

    if (typeof g.timer.unref === "function") {
      g.timer.unref();
    }

    console.log(`[DB][SupabaseKeepAlive] Cron started (interval: every ${intervalMinutes} minutes)`);
  } catch (err) {
    console.warn(`[DB][SupabaseKeepAlive] Failed to start cron: ${err.message}`);
  }
}

export function stopSupabaseKeepAlive() {
  if (g.timer) {
    clearInterval(g.timer);
    g.timer = null;
  }
}

export function getKeepAliveStatus() {
  return {
    running: !!g.timer,
    lastPingAt: g.lastPingAt,
    lastStatus: g.lastStatus,
  };
}
