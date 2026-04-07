import { ApiTestSchema } from "@/lib/core/validation";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { executeApiChain, type ApiTestStep } from "@/lib/execution/api-runner";

// POST /api/tests/api-run — execute an API test chain
export const POST = withHandler(async (request: NextRequest) => {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  try {
    const { steps, variables, project_id } = validate(ApiTestSchema, await request.json());

    if (!steps || !Array.isArray(steps) || steps.length === 0) {
      return NextResponse.json({ error: "At least 1 API test step is required" }, { status: 400 });
    }

    // Resolve environment variables from project
    const envVars: Record<string, string> = { ...variables };
    if (project_id) {
      const { data: project } = await supabase.from("projects").select("base_url").eq("id", project_id).single();
      if (project?.base_url) envVars["BASE_URL"] = project.base_url;

      const { data: envData } = await supabase.from("projects").select("id").eq("id", project_id).single();
      // Add project-level env vars here when implemented
    }

    // Execute the API test chain
    const { results, variables: finalVars, passed } = await executeApiChain(steps as ApiTestStep[], envVars);

    // Calculate summary
    const totalAssertions = results.reduce((sum, r) => sum + r.assertions.length, 0);
    const passedAssertions = results.reduce((sum, r) => sum + r.assertions.filter(a => a.passed).length, 0);
    const totalDuration = results.reduce((sum, r) => sum + r.duration_ms, 0);

    return NextResponse.json({
      data: {
        passed,
        total_steps: results.length,
        steps_passed: results.filter(r => r.status === "passed").length,
        steps_failed: results.filter(r => r.status === "failed").length,
        total_assertions: totalAssertions,
        assertions_passed: passedAssertions,
        total_duration_ms: totalDuration,
        results,
        extracted_variables: finalVars,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: "API test execution failed: " + (error as Error).message }, { status: 500 });
  }
}
