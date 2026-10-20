import { NextResponse } from "next/server";
import { runSupabaseKeepAlivePing, getKeepAliveStatus } from "@/shared/services/supabaseKeepAlive.js";

export async function GET() {
  try {
    const status = getKeepAliveStatus();
    return NextResponse.json(status);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}

export async function POST() {
  try {
    const result = await runSupabaseKeepAlivePing();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
