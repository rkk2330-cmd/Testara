import { authorize } from "@/lib/security/auth";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { DOMAIN_PROFILES, getAvailableExpressions } from "@/lib/data/engine";

// GET /api/data/profiles — list domain profiles and dynamic expressions
export const GET = withHandler(async (request: NextRequest) => {
  const type = request.nextUrl.searchParams.get("type");

  if (type === "expressions") {
    return NextResponse.json({ data: getAvailableExpressions() });
  }

  if (type === "profile") {
    const id = request.nextUrl.searchParams.get("id");
    const profile = DOMAIN_PROFILES.find(p => p.id === id);
    if (!profile) return NextResponse.json({ error: "Profile not found" }, { status: 404 });
    return NextResponse.json({ data: profile });
  }

  // Default: return all profiles
  return NextResponse.json({
    data: {
      profiles: DOMAIN_PROFILES.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description,
        field_count: p.fields.length,
      })),
      expressions: getAvailableExpressions(),
    },
  });
}

// Global error boundary — catches any unhandled errors
export const runtime = 'nodejs';

