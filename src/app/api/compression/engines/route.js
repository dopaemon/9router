import { NextResponse } from "next/server";
import { ENGINE_CATALOG, ENGINE_IDS } from "open-sse/services/compression/engineCatalog.js";
import { listEngines } from "open-sse/services/compression/engines/registry.js";

export async function GET() {
  try {
    const engines = ENGINE_IDS.map((id) => {
      const meta = ENGINE_CATALOG[id] || {};
      return {
        id,
        ...meta,
      };
    });

    return NextResponse.json({
      engines,
      count: engines.length,
    });
  } catch (error) {
    console.error("[API] Failed to get compression engines:", error);
    return NextResponse.json({ error: "Failed to list compression engines" }, { status: 500 });
  }
}
