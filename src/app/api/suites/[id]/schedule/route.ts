import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// PUT /api/suites/[id]/schedule — set or update schedule for a suite
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { id } = await params;
  const { cron, enabled } = await request.json().catch(() => ({}));

  // Validate cron expression (basic check)
  if (cron && !/^[\d*,\-\/\s]+$/.test(cron)) {
    return NextResponse.json({ error: "Invalid cron expression" }, { status: 400 });
  }

  const { error } = await supabase
    .from("test_suites")
    .update({ schedule_cron: enabled ? cron : null })
    .eq("id", id);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    data: {
      suite_id: id,
      schedule_cron: enabled ? cron : null,
      message: enabled
        ? `Suite scheduled: ${cronToHuman(cron)}`
        : "Schedule disabled",
    },
  });
}

// GET /api/suites/[id]/schedule — check if this suite has a schedule
export const GET = withHandler(async (request: NextRequest) =>
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { id } = await params;
  const { data } = await supabase.from("test_suites").select("schedule_cron").eq("id", id).single();

  return NextResponse.json({
    data: {
      scheduled: !!data?.schedule_cron,
      cron: data?.schedule_cron,
      human: data?.schedule_cron ? cronToHuman(data.schedule_cron) : null,
    },
  });
}

function cronToHuman(cron: string): string {
  const parts = cron.split(" ");
  if (parts.length !== 5) return cron;

  const [min, hour, dom, month, dow] = parts;

  if (dom === "*" && month === "*" && dow === "*") {
    return `Daily at ${hour}:${min.padStart(2, "0")}`;
  }
  if (dom === "*" && month === "*" && dow !== "*") {
    const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const dayNames = dow.split(",").map(d => days[parseInt(d)] || d).join(", ");
    return `Every ${dayNames} at ${hour}:${min.padStart(2, "0")}`;
  }
  return `Cron: ${cron}`;
}
