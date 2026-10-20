import { NextResponse } from "next/server";
import { isSetupComplete, readDbConfig } from "@/lib/db/setupStatus.js";
import { isCfD1Enabled, getPostgresUrl, getAdapter } from "@/lib/db/driver.js";

export async function GET() {
  try {
    const setupCompleted = isSetupComplete();
    const fileConfig = readDbConfig();
    const cfD1Env = isCfD1Enabled();
    const pgUrlEnv = getPostgresUrl();

    let currentDriver = "sqlite";
    if (cfD1Env || fileConfig?.driver === "cloudflare-d1") {
      currentDriver = "cloudflare-d1";
    } else if (pgUrlEnv || fileConfig?.driver === "postgres") {
      currentDriver = "postgres";
    }
    return NextResponse.json({
      setupNeeded: !setupCompleted,
      setupCompleted,
      currentDriver,
      hasEnvConfig: !!(cfD1Env || pgUrlEnv),
    });
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
