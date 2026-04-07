import { NextResponse } from "next/server";
import { withHandler } from "@/lib/core";

export const GET = withHandler(async () => {
  return NextResponse.json({ status: "ok", timestamp: new Date().toISOString(), version: "1.0.0" });
});
