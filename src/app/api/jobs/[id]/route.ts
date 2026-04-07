import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withErrorHandler } from "@/lib/core";
import { jobQueue } from "@/lib/events/queue";

export const GET = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error }, { status });

  const { id } = await params;
  const job = jobQueue.getJob(id);
  if (!job) return NextResponse.json({ error: "Job not found" }, { status: 404 });
  if (job.orgId !== auth.org_id) return NextResponse.json({ error: "Access denied" }, { status: 403 });

  return NextResponse.json({ data: { id: job.id, type: job.type, status: job.status, result: job.result, error: job.error } });
});
