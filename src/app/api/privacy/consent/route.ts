import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { logger } from "@/lib/core/logger";

// POST /api/privacy/consent — Record consent (called at first login/signup)
export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));

  await supabase.from("consent_records").insert({
    user_id: auth.user_id,
    org_id: auth.org_id,
    consent_type: body.type || "data_processing",
    consent_version: "1.0",
    purposes: ["account_management", "test_automation", "ai_generation", "analytics"],
    granted: true,
    ip_address: request.headers.get("x-forwarded-for") || "unknown",
    user_agent: request.headers.get("user-agent") || "unknown",
  });

  logger.info("privacy.consent_recorded", { userId: auth.user_id, type: body.type || "data_processing" });

  return NextResponse.json({ data: { recorded: true } });
});

// GET /api/privacy/consent — Check consent status
export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error }, { status });

  const { data } = await supabase.from("consent_records")
    .select("*").eq("user_id", auth.user_id).order("created_at", { ascending: false }).limit(1);

  return NextResponse.json({ data: { hasConsent: (data || []).length > 0, latestConsent: data?.[0] || null } });
});
