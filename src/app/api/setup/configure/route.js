import { NextResponse } from "next/server";
import { isSetupComplete, writeDbConfig, saveEnvConfig } from "@/lib/db/setupStatus.js";
import { resetAdapter } from "@/lib/db/driver.js";
import { isLocalRequest } from "@/dashboardGuard.js";

export async function POST(request) {
  try {
    // Only local requests or non-completed setups can configure the database
    if (isSetupComplete() && !isLocalRequest(request)) {
      return NextResponse.json({ error: "Setup is already completed and cannot be re-run remotely" }, { status: 403 });
    }

    const body = await request.json();
    const { driver, d1, postgres } = body;

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

    return NextResponse.json({ success: true, driver: cfg.driver });
  } catch (error) {
    console.error("[DB][setup] Error in setup:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
