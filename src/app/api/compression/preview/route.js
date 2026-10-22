import { NextResponse } from "next/server";
import { applyCompressionAsync } from "open-sse/services/compression/strategySelector.js";

export async function POST(request) {
  try {
    const payload = await request.json();
    const mode = payload.mode || "stacked";

    // Prepare body: can receive either { messages: [...] } or { text: "..." }
    let body = {};
    if (Array.isArray(payload.messages)) {
      body.messages = payload.messages;
    } else if (typeof payload.text === "string") {
      body.messages = [{ role: "user", content: payload.text }];
    } else if (payload.body && typeof payload.body === "object") {
      body = payload.body;
    } else {
      return NextResponse.json({ error: "Missing text or messages to preview" }, { status: 400 });
    }

    const result = await applyCompressionAsync(body, mode, {
      stackedPipeline: payload.stackedPipeline,
      stepConfig: payload.config,
    });

    return NextResponse.json({
      compressed: result.compressed,
      body: result.body,
      stats: result.stats,
    });
  } catch (error) {
    console.error("[API] Failed to preview compression:", error);
    return NextResponse.json({ error: error?.message || "Failed to preview compression" }, { status: 500 });
  }
}
