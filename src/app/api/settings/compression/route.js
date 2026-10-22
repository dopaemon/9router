import { NextResponse } from "next/server";
import { getSettings, updateSettings } from "@/lib/localDb";

export async function GET() {
  try {
    const settings = await getSettings();
    return NextResponse.json({
      enabled: settings.compressionEnabled !== false,
      mode: settings.compressionMode || "stacked",
      stackedPipeline: settings.stackedPipeline || settings.compressionConfig?.stackedPipeline || [],
      config: settings.compressionConfig || {},
    });
  } catch (error) {
    console.error("[API] Failed to get compression settings:", error);
    return NextResponse.json({ error: "Failed to get compression settings" }, { status: 500 });
  }
}

export async function PUT(request) {
  try {
    const body = await request.json();
    const updates = {};

    if (body.enabled !== undefined) updates.compressionEnabled = Boolean(body.enabled);
    if (body.mode !== undefined) updates.compressionMode = String(body.mode);
    if (body.stackedPipeline !== undefined) updates.stackedPipeline = body.stackedPipeline;

    const currentSettings = await getSettings();
    const currentConfig = currentSettings.compressionConfig || {};
    updates.compressionConfig = { ...currentConfig, ...body };

    await updateSettings(updates);
    return NextResponse.json({ success: true, ...updates });
  } catch (error) {
    console.error("[API] Failed to update compression settings:", error);
    return NextResponse.json({ error: "Failed to update compression settings" }, { status: 500 });
  }
}
