// ===========================================
// TESTARA — Input Validation Schemas (Zod)
// Every API input validated before processing
// ===========================================

import { z } from "zod";

// ===== COMMON =====
export const UuidSchema = z.string().uuid("Invalid ID format");
export const EmailSchema = z.string().email("Invalid email address").max(255);
export const UrlSchema = z.string().url("Invalid URL").max(2048);

// ===== TEST CASES =====
export const CreateTestSchema = z.object({
  title: z.string().min(1, "Title is required").max(200, "Title too long (max 200 chars)"),
  description: z.string().max(2000).optional(),
  project_id: z.string().uuid("Invalid project ID"),
  tags: z.array(z.string().max(50)).max(20).optional().default([]),
  priority: z.enum(["critical", "high", "medium", "low"]).optional().default("medium"),
  steps: z.array(z.object({
    order_index: z.number().int().min(0),
    action_type: z.string().min(1),
    target: z.object({
      selector: z.string().default(""),
      fallback_selectors: z.record(z.string().nullable()).default({}),
      description: z.string().default(""),
    }).default({ selector: "", fallback_selectors: {}, description: "" }),
    input_data: z.string().max(10000).nullable().optional(),
    expected_result: z.string().max(2000).nullable().optional(),
  })).min(0).max(200),
});

export const UpdateTestSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  tags: z.array(z.string().max(50)).max(20).optional(),
  status: z.enum(["draft", "active", "archived"]).optional(),
  priority: z.enum(["critical", "high", "medium", "low"]).optional(),
  steps: z.array(z.object({
    order_index: z.number().int().min(0),
    action_type: z.string().min(1),
    target: z.object({
      selector: z.string().default(""),
      fallback_selectors: z.record(z.string().nullable()).default({}),
      description: z.string().default(""),
    }),
    input_data: z.string().max(10000).nullable().optional(),
    expected_result: z.string().max(2000).nullable().optional(),
  })).max(200).optional(),
});

// ===== PROJECTS =====
export const CreateProjectSchema = z.object({
  name: z.string().min(1, "Project name is required").max(100),
  base_url: z.string().url("Invalid base URL").max(2048).optional().default(""),
  description: z.string().max(1000).optional(),
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  base_url: z.string().max(2048).optional(),
  description: z.string().max(1000).optional(),
});

// ===== TEST SUITES =====
export const CreateSuiteSchema = z.object({
  name: z.string().min(1, "Suite name is required").max(100),
  description: z.string().max(1000).optional(),
  project_id: z.string().uuid("Invalid project ID"),
  test_case_ids: z.array(z.string().uuid()).min(1, "Add at least one test case").max(500),
  schedule_cron: z.string().max(100).optional(),
});

export const UpdateSuiteSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().max(1000).optional(),
  test_case_ids: z.array(z.string().uuid()).max(500).optional(),
  schedule_cron: z.string().max(100).nullable().optional(),
});

// ===== TEST DATA =====
export const CreateDatasetSchema = z.object({
  name: z.string().min(1, "Dataset name is required").max(100),
  project_id: z.string().uuid().optional(),
  columns: z.array(z.string().min(1).max(50)).min(1, "At least one column required").max(50),
  rows: z.array(z.record(z.string())).max(10000).optional().default([]),
});

export const UpdateDatasetSchema = z.object({
  id: z.string().uuid("Dataset ID required"),
  name: z.string().min(1).max(100).optional(),
  columns: z.array(z.string().max(50)).max(50).optional(),
  rows: z.array(z.record(z.string())).max(10000).optional(),
});

// ===== AI GENERATION =====
export const GenerateFromUrlSchema = z.object({
  url: z.string().url("Enter a valid URL"),
  project_id: z.string().uuid("Select a project"),
  depth: z.enum(["quick", "thorough"]).optional().default("quick"),
});

export const GenerateFromStorySchema = z.object({
  user_story: z.string().min(10, "Story must be at least 10 characters").max(5000),
  project_id: z.string().uuid("Select a project"),
  depth: z.enum(["quick", "thorough"]).optional().default("quick"),
});

export const GenerateDataSchema = z.object({
  prompt: z.string().min(5, "Describe what data you need").max(1000),
  rows: z.number().int().min(1).max(100).optional().default(10),
  project_id: z.string().uuid().optional(),
});

// ===== TEAM =====
export const InviteTeamMemberSchema = z.object({
  email: z.string().email("Valid email is required"),
  role: z.enum(["qa_lead", "tester", "viewer"]).optional().default("tester"),
});

export const UpdateMemberRoleSchema = z.object({
  user_id: z.string().uuid("User ID required"),
  role: z.enum(["qa_lead", "tester", "viewer"]),
});

// ===== BILLING =====
export const CreateOrderSchema = z.object({
  plan: z.enum(["pro", "business"], { message: "Invalid plan. Use: pro, business" }),
});

export const VerifyPaymentSchema = z.object({
  razorpay_order_id: z.string().min(1),
  razorpay_payment_id: z.string().min(1),
  razorpay_signature: z.string().min(1),
  plan: z.enum(["pro", "business"]),
});

// ===== TEST EXECUTION =====
export const RunTestSchema = z.object({
  browser: z.enum(["chromium", "firefox", "webkit"]).optional().default("chromium"),
  viewport: z.object({
    width: z.number().int().min(320).max(3840).optional().default(1280),
    height: z.number().int().min(240).max(2160).optional().default(720),
  }).optional(),
  variables: z.record(z.string()).optional(),
});

// ===== HELPER: Parse and throw =====
import { ValidationError } from "./errors";

export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const path = issue.path.join(".");
      fieldErrors[path || "_root"] = issue.message;
    }
    const firstError = result.error.issues[0]?.message || "Invalid input";
    throw new ValidationError(firstError, fieldErrors);
  }
  return result.data;
}

// ===== ADDITIONAL SCHEMAS =====

export const AssistantMessageSchema = z.object({
  message: z.string().min(1, "Message is required").max(2000),
  context: z.string().max(5000).optional(),
});

export const HealApproveSchema = z.object({
  approved: z.boolean(),
});

export const RunSuiteSchema = z.object({
  browser: z.enum(["chromium", "firefox", "webkit"]).optional().default("chromium"),
});

export const ScheduleSuiteSchema = z.object({
  cron: z.string().min(1).max(100),
  enabled: z.boolean().optional().default(true),
});

export const CITriggerSchema = z.object({
  suite_id: z.string().uuid().optional(),
  test_ids: z.array(z.string().uuid()).optional(),
  browser: z.enum(["chromium", "firefox", "webkit"]).optional().default("chromium"),
  triggered_by: z.string().max(50).optional().default("ci"),
});

export const JiraIntegrationSchema = z.object({
  action: z.enum(["connect", "create_issue", "sync"]),
  config: z.record(z.string()).optional(),
  issue: z.object({
    summary: z.string().max(200),
    description: z.string().max(5000),
    project_key: z.string().max(20),
    issue_type: z.string().max(50).optional().default("Bug"),
  }).optional(),
});

export const MainframeCommandSchema = z.object({
  action: z.enum(["connect", "disconnect", "send", "read"]),
  host: z.string().max(255).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  data: z.string().max(1000).optional(),
});

export const NotificationSchema = z.object({
  channel: z.enum(["slack", "email", "webhook"]),
  message: z.string().max(2000).optional(),
  run_id: z.string().uuid().optional(),
});

export const EnvironmentSchema = z.object({
  name: z.string().min(1).max(50),
  variables: z.record(z.string().max(1000)).optional().default({}),
  base_url: z.string().url().optional(),
});

export const ImportTestsSchema = z.object({
  project_id: z.string().uuid(),
  format: z.enum(["csv", "json"]),
  data: z.string().min(1),
});

export const RecordingSchema = z.object({
  project_id: z.string().uuid(),
  title: z.string().min(1).max(200),
  actions: z.array(z.object({
    type: z.string(),
    target: z.object({
      selector: z.string(),
      fallback_selectors: z.record(z.string().nullable()).optional().default({}),
      description: z.string().optional().default(""),
    }),
    value: z.string().optional(),
    timestamp: z.number(),
    page_url: z.string(),
  })).min(1),
});

export const ApiTestSchema = z.object({
  steps: z.array(z.object({
    id: z.string().optional(),
    order_index: z.number().int().min(0),
    name: z.string().max(200).optional(),
    method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
    url: z.string().min(1),
    headers: z.record(z.string()).optional().default({}),
    body: z.string().optional(),
    auth: z.object({
      type: z.enum(["bearer", "basic", "api_key", "none"]),
      token: z.string().optional(),
      username: z.string().optional(),
      password: z.string().optional(),
      key_name: z.string().optional(),
      key_value: z.string().optional(),
    }).optional(),
    assertions: z.array(z.object({
      type: z.string(),
      target: z.string().optional(),
      expected: z.string(),
      operator: z.string().optional(),
    })).optional().default([]),
    extract: z.array(z.object({
      variable: z.string(),
      source: z.enum(["body", "header", "status", "response_time"]),
      path: z.string().optional(),
    })).optional(),
  })).min(1),
  variables: z.record(z.string()).optional(),
  project_id: z.string().uuid().optional(),
});
