import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { withErrorHandler } from "@/lib/core";
import { generateTestPlan, generateTestSummaryReport, generateTraceabilityMatrix, generateComplianceReport, exportAuditLog } from "@/lib/compliance/reports";

// GET /api/reports/compliance/[type] — Generate compliance reports
// Types: test_plan, test_summary, traceability, soc2, hipaa, pci_dss, iso27001, rbi, irdai, audit_log
export const GET = withErrorHandler(async (request, { params }) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_reports" });
  if (!auth) return NextResponse.json({ error }, { status });

  const { type } = await params;
  const projectId = request.nextUrl.searchParams.get("project_id");
  const from = request.nextUrl.searchParams.get("from") || undefined;
  const to = request.nextUrl.searchParams.get("to") || undefined;

  if (!projectId && type !== "audit_log") {
    return NextResponse.json({ error: "project_id query parameter required" }, { status: 400 });
  }

  let report: Record<string, unknown>;

  switch (type) {
    case "test_plan":
      report = await generateTestPlan(supabase, projectId!, auth.org_id);
      break;
    case "test_summary":
      report = await generateTestSummaryReport(supabase, projectId!, from && to ? { from, to } : undefined);
      break;
    case "traceability":
      report = await generateTraceabilityMatrix(supabase, projectId!);
      break;
    case "soc2": case "hipaa": case "pci_dss": case "iso27001": case "rbi": case "irdai":
      report = await generateComplianceReport(supabase, projectId!, type as "soc2");
      break;
    case "audit_log":
      report = await exportAuditLog(supabase, auth.org_id, from && to ? { from, to } : undefined);
      break;
    default:
      return NextResponse.json({ error: `Unknown report type: ${type}. Valid: test_plan, test_summary, traceability, soc2, hipaa, pci_dss, iso27001, rbi, irdai, audit_log` }, { status: 400 });
  }

  return NextResponse.json({ data: report });
});
