import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// GET /api/projects/[id]/environments — list environments for a project
export const GET = withHandler(async (request: NextRequest) =>
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { id } = await params;
  const { data: project } = await supabase.from("projects").select("settings").eq("id", id).single();

  const environments = (project as unknown)?.settings?.environments || {
    dev: { base_url: "", variables: {} },
    staging: { base_url: "", variables: {} },
    production: { base_url: "", variables: {} },
  };

  return NextResponse.json({ data: environments });
}

// PUT /api/projects/[id]/environments — update environments
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { id } = await params;
  const body = await request.json().catch(() => ({}));

  // Get current project settings
  const { data: project } = await supabase.from("projects").select("mainframe_config").eq("id", id).single();
  const currentConfig = (project as unknown)?.mainframe_config || {};

  // Store environments in mainframe_config field (reusing JSONB column)
  // In production, add a dedicated 'settings' JSONB column
  await supabase
    .from("projects")
    .update({
      mainframe_config: { ...currentConfig, environments: body.environments },
    })
    .eq("id", id);

  return NextResponse.json({ data: { updated: true } });
}
