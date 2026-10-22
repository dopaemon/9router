import { NextResponse } from "next/server";
import { exportDb, getSettings, importDb, resetDb } from "@/lib/localDb";
import { applyOutboundProxyEnv } from "@/lib/network/outboundProxy";
import { verifyDashboardPassword } from "@/lib/auth/dashboardSession";

const CLI_TOKEN_HEADER = "x-9r-cli-token";
const PASSWORD_HEADER = "x-9r-password";

// CLI token requests are already trusted (local machine); skip password re-auth.
function isCliRequest(request) {
  return Boolean(request.headers.get(CLI_TOKEN_HEADER));
}

export async function GET(request) {
  try {
    if (!isCliRequest(request) && !(await verifyDashboardPassword(request.headers.get(PASSWORD_HEADER)))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const format = (searchParams.get("format") || "json").toLowerCase();

    if (format === "sqlite") {
      const { exportDbSqlite } = await import("@/lib/localDb");
      const buffer = await exportDbSqlite();
      const stamp = new Date().toISOString().replace(/[.:]/g, "-");
      return new Response(buffer, {
        status: 200,
        headers: {
          "Content-Type": "application/x-sqlite3",
          "Content-Disposition": `attachment; filename="9router-backup-${stamp}.sqlite"`,
          "Content-Length": String(buffer.length),
        },
      });
    }

    const payload = await exportDb();
    return NextResponse.json(payload);
  } catch (error) {
    console.log("Error exporting database:", error);
    return NextResponse.json({ error: "Failed to export database" }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const contentType = request.headers.get("content-type") || "";

    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      const password = formData.get("password");
      if (!isCliRequest(request) && !(await verifyDashboardPassword(password))) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }
      const file = formData.get("file");
      if (!file) {
        return NextResponse.json({ error: "No backup file uploaded" }, { status: 400 });
      }
      const fileName = (file.name || "").toLowerCase();
      const buf = Buffer.from(await file.arrayBuffer());

      if (fileName.endsWith(".sqlite") || fileName.endsWith(".db") || buf.subarray(0, 16).toString("utf8").startsWith("SQLite format 3")) {
        const { importDbFromSqlite } = await import("@/lib/localDb");
        await importDbFromSqlite(buf);
      } else {
        const raw = buf.toString("utf8");
        const payload = JSON.parse(raw);
        await importDb(payload);
      }
    } else {
      const body = await request.json();
      const { password, ...payload } = body;
      if (!isCliRequest(request) && !(await verifyDashboardPassword(password))) {
        return NextResponse.json({ error: "Invalid password" }, { status: 401 });
      }

      if (payload.sqliteBase64) {
        const buf = Buffer.from(payload.sqliteBase64, "base64");
        const { importDbFromSqlite } = await import("@/lib/localDb");
        await importDbFromSqlite(buf);
      } else {
        await importDb(payload);
      }
    }

    // Ensure proxy settings take effect immediately after a DB import.
    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (err) {
      console.warn("[Settings][DatabaseImport] Failed to re-apply outbound proxy env:", err);
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.log("Error importing database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to import database" },
      { status: 400 }
    );
  }
}
export async function PUT(request) {
  try {
    const body = await request.json();
    const { password, driver, d1, postgres, migrateData = true } = body;

    const pw = request.headers.get(PASSWORD_HEADER) || password;
    if (!isCliRequest(request) && !(await verifyDashboardPassword(pw))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }

    const selectedDriver = driver || "sqlite";
    let cfg = { configured: true, driver: selectedDriver };

    if (selectedDriver === "cloudflare-d1") {
      const accountId = (d1?.accountId || "").trim();
      const databaseId = (d1?.databaseId || "").trim();
      const apiToken = (d1?.apiToken || "").trim();

      if (!accountId || !databaseId || !apiToken) {
        return NextResponse.json(
          { error: "Vui lòng nhập đầy đủ Account ID, Database ID và API Token cho Cloudflare D1." },
          { status: 400 }
        );
      }

      const { createCloudflareD1Adapter } = await import("@/lib/db/adapters/cloudflareD1Adapter.js");
      try {
        const testAdapter = createCloudflareD1Adapter({ accountId, databaseId, apiToken });
        await testAdapter.get("SELECT 1 as ping");
      } catch (err) {
        return NextResponse.json(
          { error: `Kết nối Cloudflare D1 thất bại: ${err.message}` },
          { status: 400 }
        );
      }

      cfg.d1 = { accountId, databaseId, apiToken };
    } else if (selectedDriver === "postgres") {
      const url = (postgres?.url || "").trim();
      if (!url) {
        return NextResponse.json(
          { error: "Vui lòng nhập Connection String của Supabase / PostgreSQL." },
          { status: 400 }
        );
      }

      const { createPostgresAdapter } = await import("@/lib/db/adapters/postgresAdapter.js");
      try {
        const testAdapter = await createPostgresAdapter(url);
        await testAdapter.get("SELECT 1 as ping");
        await testAdapter.close?.();
      } catch (err) {
        return NextResponse.json(
          { error: `Kết nối Supabase / Postgres thất bại: ${err.message}` },
          { status: 400 }
        );
      }

      cfg.postgres = { url };
    } else {
      // Local SQLite
      cfg.driver = "sqlite";
    }

    // Export current DB data if migration is requested
    let currentPayload = null;
    if (migrateData) {
      try {
        currentPayload = await exportDb();
      } catch (expErr) {
        console.warn("[Settings][DatabaseSwitch] Export current DB failed:", expErr.message);
      }
    }

    const { writeDbConfig, saveEnvConfig } = await import("@/lib/db/setupStatus.js");
    const { resetAdapter } = await import("@/lib/db/driver.js");

    writeDbConfig(cfg);
    saveEnvConfig(cfg);
    await resetAdapter();

    // Import current data into the newly activated adapter
    if (migrateData && currentPayload) {
      try {
        await importDb(currentPayload);
      } catch (impErr) {
        console.warn("[Settings][DatabaseSwitch] Migration into new DB failed:", impErr.message);
      }
    }

    try {
      const settings = await getSettings();
      applyOutboundProxyEnv(settings);
    } catch (_) {}

    return NextResponse.json({
      success: true,
      driver: cfg.driver,
      migrated: Boolean(migrateData && currentPayload)
    });
  } catch (error) {
    console.error("[Settings][DatabaseSwitch] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to switch database" },
      { status: 500 }
    );
  }
}

export async function DELETE(request) {
  try {
    const { password } = await request.json().catch(() => ({}));
    if (!isCliRequest(request) && !(await verifyDashboardPassword(password))) {
      return NextResponse.json({ error: "Invalid password" }, { status: 401 });
    }
    await resetDb(false);

    // Clear persisted setup configuration so system prompts for setup again
    const { clearDbSetupConfig } = await import("@/lib/db/setupStatus.js");
    clearDbSetupConfig();

    const { resetAdapter } = await import("@/lib/db/driver.js");
    await resetAdapter();

    return NextResponse.json({ success: true, redirect: "/setup" });
  } catch (error) {
    console.error("Error resetting database:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to reset database" },
      { status: 500 }
    );
  }
}
