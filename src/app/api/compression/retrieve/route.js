import { NextResponse } from "next/server";
import { handleCcrRetrieve } from "open-sse/services/compression/engines/ccr/index.js";

export async function POST(request) {
  try {
    const { hash, principalId } = await request.json();
    if (!hash || typeof hash !== "string") {
      return NextResponse.json({ error: "Missing or invalid hash" }, { status: 400 });
    }

    let content = handleCcrRetrieve(hash, principalId);
    if (!content && principalId) {
      content = handleCcrRetrieve(hash, "__anon__");
    }
    if (!content) {
      return NextResponse.json({ error: "Block not found or expired" }, { status: 404 });
    }

    return NextResponse.json({
      hash,
      content,
      chars: content.length,
    });
  } catch (error) {
    console.error("[API] Failed to retrieve CCR block:", error);
    return NextResponse.json({ error: "Failed to retrieve block" }, { status: 500 });
  }
}
