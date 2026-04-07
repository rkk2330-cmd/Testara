import { NotificationSchema } from "@/lib/core/validation";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";

export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error }, { status });

  const body = validate(NotificationSchema, await request.json());
  const { channel, message, run_id } = body;

  if (channel === "slack" && process.env.SLACK_WEBHOOK_URL) {
    await fetch(process.env.SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message || `Test run ${run_id} completed` }),
    }).catch(() => {});
  }

  return NextResponse.json({ data: { sent: true } });
});
