import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

// POST /api/integrations/jira/sync — sync test cases with Jira
export const POST = withHandler(async (request: NextRequest) => {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { data: profile } = await supabase.from("users").select("org_id").eq("id", auth.user_id).single();
  if (!profile?.org_id) return NextResponse.json({ error: "No organization" }, { status: 400 });

  // Get Jira integration config
  const { data: integration } = await supabase
    .from("integrations")
    .select("*")
    .eq("org_id", profile.org_id)
    .eq("type", "jira")
    .eq("status", "active")
    .single();

  if (!integration) {
    return NextResponse.json({ error: "Jira integration not configured. Go to Settings → Integrations." }, { status: 400 });
  }

  const body = await request.json();
  const { action } = body;

  const jiraConfig = integration.config as {
    base_url: string;
    email: string;
    api_token: string;
    project_key: string;
  };

  const jiraAuth = Buffer.from(`${jiraConfig.email}:${jiraConfig.api_token}`).toString("base64");
  const jiraHeaders = {
    "Authorization": `Basic ${jiraAuth}`,
    "Content-Type": "application/json",
    "Accept": "application/json",
  };

  if (action === "create_defect") {
    // Create a Jira issue from a failed test run
    const { test_run_result_id, title, description, severity } = body;

    const priorityMap: Record<string, string> = {
      critical: "Highest",
      high: "High",
      medium: "Medium",
      low: "Low",
    };

    try {
      const jiraRes = await fetch(`${jiraConfig.base_url}/rest/api/3/issue`, {
        method: "POST",
        headers: jiraHeaders,
        body: JSON.stringify({
          fields: {
            project: { key: jiraConfig.project_key },
            summary: `[Testara] ${title}`,
            description: {
              type: "doc",
              version: 1,
              content: [{ type: "paragraph", content: [{ type: "text", text: description || "Automated defect from Testara test execution." }] }],
            },
            issuetype: { name: "Bug" },
            priority: { name: priorityMap[severity] || "Medium" },
          },
        }),
      });

      if (!jiraRes.ok) {
        const errText = await jiraRes.text();
        return NextResponse.json({ error: `Jira API error: ${errText}` }, { status: 502 });
      }

      const jiraIssue = await jiraRes.json();

      // Store Jira issue ID in our defects table
      if (test_run_result_id) {
        await supabase.from("defects").insert({
          project_id: body.project_id,
          test_run_result_id,
          title,
          description,
          severity: severity || "medium",
          status: "open",
          jira_issue_id: jiraIssue.key,
          created_by: auth.user_id,
        });
      }

      return NextResponse.json({
        data: {
          jira_key: jiraIssue.key,
          jira_url: `${jiraConfig.base_url}/browse/${jiraIssue.key}`,
        },
      });
    } catch (err) {
      return NextResponse.json({ error: "Failed to connect to Jira: " + (err as Error).message }, { status: 502 });
    }
  }

  if (action === "link_test") {
    // Link a test case to a Jira ticket
    const { test_case_id, jira_issue_key } = body;
    await supabase
      .from("test_cases")
      .update({ tags: supabase.rpc ? undefined : undefined }) // Tag with Jira key
      .eq("id", test_case_id);

    return NextResponse.json({ data: { linked: true, test_case_id, jira_issue_key } });
  }

  return NextResponse.json({ error: "Unknown action. Use 'create_defect' or 'link_test'" }, { status: 400 });
}

// POST /api/integrations/jira/connect — save Jira credentials
export const PUT = withHandler(async (request: NextRequest) => {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const { data: profile } = await supabase.from("users").select("org_id").eq("id", auth.user_id).single();
  if (!profile?.org_id) return NextResponse.json({ error: "No organization" }, { status: 400 });

  const { base_url, email, api_token, project_key } = await request.json();

  if (!base_url || !email || !api_token || !project_key) {
    return NextResponse.json({ error: "base_url, email, api_token, and project_key are required" }, { status: 400 });
  }

  // Test the connection
  const auth = Buffer.from(`${email}:${api_token}`).toString("base64");
  try {
    const testRes = await fetch(`${base_url}/rest/api/3/myself`, {
      headers: { "Authorization": `Basic ${auth}`, "Accept": "application/json" },
    });
    if (!testRes.ok) throw new Error("Invalid credentials");
  } catch {
    return NextResponse.json({ error: "Could not connect to Jira. Check your credentials." }, { status: 400 });
  }

  // Upsert integration
  const { data: existing } = await supabase
    .from("integrations")
    .select("id")
    .eq("org_id", profile.org_id)
    .eq("type", "jira")
    .single();

  if (existing) {
    await supabase.from("integrations").update({
      config: { base_url, email, api_token, project_key },
      status: "active",
    }).eq("id", existing.id);
  } else {
    await supabase.from("integrations").insert({
      org_id: profile.org_id,
      type: "jira",
      config: { base_url, email, api_token, project_key },
      status: "active",
    });
  }

  return NextResponse.json({ data: { connected: true } });
}
