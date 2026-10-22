import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSetupComplete, writeDbConfig, saveEnvConfig } from "@/lib/db/setupStatus.js";
import { resetAdapter } from "@/lib/db/driver.js";
import { isLocalRequest } from "@/dashboardGuard.js";
import { setDashboardAuthCookie } from "@/lib/auth/dashboardSession";
export async function POST(request) {
  try {
    // Only local requests or non-completed setups can configure the database
    if (isSetupComplete() && !isLocalRequest(request)) {
      return NextResponse.json({ error: "Setup is already completed and cannot be re-run remotely" }, { status: 403 });
    }

    let driver = "sqlite";
    let d1 = null;
    let postgres = null;
    let backupFileBuffer = null;
    let backupFileName = "";

    const contentType = request.headers.get("content-type") || "";
    if (contentType.includes("multipart/form-data")) {
      const formData = await request.formData();
      driver = (formData.get("driver") || "sqlite").toString();
      const d1Json = formData.get("d1");
      if (d1Json) {
        try { d1 = typeof d1Json === "string" ? JSON.parse(d1Json) : d1Json; } catch {}
      } else {
        d1 = {
          accountId: formData.get("cfAccountId")?.toString(),
          databaseId: formData.get("cfDatabaseId")?.toString(),
          apiToken: formData.get("cfApiToken")?.toString(),
        };
      }
      const pgJson = formData.get("postgres");
      if (pgJson) {
        try { postgres = typeof pgJson === "string" ? JSON.parse(pgJson) : pgJson; } catch {}
      } else {
        postgres = { url: formData.get("pgUrl")?.toString() };
      }

      const file = formData.get("backupFile");
      if (file && typeof file.arrayBuffer === "function") {
        backupFileName = (file.name || "").toLowerCase();
        const ab = await file.arrayBuffer();
        if (ab.byteLength > 0) {
          backupFileBuffer = Buffer.from(ab);
        }
      }
    } else {
      const body = await request.json();
      driver = body.driver || "sqlite";
      d1 = body.d1;
      postgres = body.postgres;
      if (body.backup) {
        backupFileName = (body.backup.filename || "").toLowerCase();
        if (body.backup.sqliteBase64) {
          backupFileBuffer = Buffer.from(body.backup.sqliteBase64, "base64");
        } else if (body.backup.jsonContent) {
          backupFileBuffer = Buffer.from(body.backup.jsonContent, "utf8");
        }
      }
    }

    let cfg = { configured: true, driver: driver || "sqlite" };

    if (driver === "cloudflare-d1") {
      const accountId = (d1?.accountId || "").trim();
      const databaseId = (d1?.databaseId || "").trim();
      const apiToken = (d1?.apiToken || "").trim();

      if (!accountId || !databaseId || !apiToken) {
        return NextResponse.json(
          { error: "Vui lòng nhập đầy đủ Account ID, Database ID và API Token cho Cloudflare D1." },
          { status: 400 }
        );
      }

      // Test probe Cloudflare D1 before saving
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
    } else if (driver === "postgres") {
      const url = (postgres?.url || "").trim();
      if (!url) {
        return NextResponse.json(
          { error: "Vui lòng nhập Connection String của Supabase / PostgreSQL." },
          { status: 400 }
        );
      }

      // Test probe Postgres before saving
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

    // Persist to json config and write to .env if possible
    writeDbConfig(cfg);
    saveEnvConfig(cfg);

    // Re-initialize adapter with new config
    await resetAdapter();

    // If backup file provided, import it now
    if (backupFileBuffer && backupFileBuffer.length > 0) {
      try {
        const isSqlite =
          backupFileName.endsWith(".sqlite") ||
          backupFileName.endsWith(".db") ||
          backupFileBuffer.subarray(0, 16).toString("utf8").startsWith("SQLite format 3");

        if (isSqlite) {
          const { importDbFromSqlite } = await import("@/lib/localDb");
          await importDbFromSqlite(backupFileBuffer);
        } else {
          const raw = backupFileBuffer.toString("utf8");
          const payload = JSON.parse(raw);
          const { importDb } = await import("@/lib/localDb");
          await importDb(payload);
        }
      } catch (importErr) {
        console.error("[DB][setup] Error importing backup:", importErr);
        return NextResponse.json(
          { error: `Cấu hình DB thành công nhưng import file backup thất bại: ${importErr.message}` },
          { status: 400 }
        );
      }
    }

    // Auto-authenticate the setup session so the user is immediately logged in
    try {
      const cookieStore = await cookies();
      await setDashboardAuthCookie(cookieStore, request);
    } catch (authErr) {
      console.warn("[DB][setup] Could not set auth cookie automatically:", authErr.message);
    }

    return NextResponse.json({
      success: true,
      driver: cfg.driver,
      imported: Boolean(backupFileBuffer && backupFileBuffer.length > 0),
    });
  } catch (error) {
    console.error("[DB][setup] Error in setup:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
