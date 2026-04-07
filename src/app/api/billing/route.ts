import { CreateOrderSchema, VerifyPaymentSchema } from "@/lib/core/validation";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import crypto from "crypto";

const RAZORPAY_KEY_ID = process.env.RAZORPAY_KEY_ID || "";
const RAZORPAY_KEY_SECRET = process.env.RAZORPAY_KEY_SECRET || "";

const PLAN_PRICES: Record<string, { amount: number; currency: string; name: string }> = {
  pro: { amount: 399900, currency: "INR", name: "Testara Pro" },
  business: { amount: 799900, currency: "INR", name: "Testara Business" },
};

// POST /api/billing — create Razorpay order
export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_billing" });
  if (!auth) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));
  const { plan } = validate(CreateOrderSchema, body);

  if (!plan || !PLAN_PRICES[plan]) {
    return NextResponse.json({ error: "Invalid plan. Use: pro, business" }, { status: 400 });
  }

  if (auth.plan === plan) {
    return NextResponse.json({ error: `Already on ${plan} plan` }, { status: 400 });
  }

  const planInfo = PLAN_PRICES[plan];

  try {
    const orderRes = await fetch("https://api.razorpay.com/v1/orders", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${Buffer.from(`${RAZORPAY_KEY_ID}:${RAZORPAY_KEY_SECRET}`).toString("base64")}`,
      },
      body: JSON.stringify({
        amount: planInfo.amount,
        currency: planInfo.currency,
        receipt: `testara_${auth.org_id}_${plan}_${Date.now()}`,
        notes: { org_id: auth.org_id, user_id: auth.user_id, plan },
      }),
    });

    const order = await orderRes.json();
    if (!order.id) return NextResponse.json({ error: "Failed to create order" }, { status: 500 });

    return NextResponse.json({
      data: {
        order_id: order.id, amount: planInfo.amount, currency: planInfo.currency,
        plan_name: planInfo.name, key_id: RAZORPAY_KEY_ID,
        prefill: { email: auth.email },
      },
    });
  } catch (err) {
    return NextResponse.json({ error: "Payment unavailable: " + (err as Error).message }, { status: 500 });
  }
}

// PUT /api/billing — verify payment + upgrade plan
export const PUT = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "manage_billing" });
  if (!auth) return NextResponse.json({ error }, { status });

  const body = await request.json().catch(() => ({}));
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature, plan } = body;

  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature || !plan) {
    return NextResponse.json({ error: "Missing payment fields" }, { status: 400 });
  }

  // Cryptographic signature verification
  const expected = crypto
    .createHmac("sha256", RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest("hex");

  if (expected !== razorpay_signature) {
    return NextResponse.json({ error: "Invalid payment signature" }, { status: 400 });
  }

  // Upgrade plan
  const { error: updateErr } = await supabase
    .from("organizations")
    .update({ plan, billing_email: auth.email, updated_at: new Date().toISOString() })
    .eq("id", auth.org_id);

  if (updateErr) return NextResponse.json({ error: "Upgrade failed: " + updateErr.message }, { status: 500 });

  console.log(`[Testara Billing] Upgraded: org=${auth.org_id} plan=${plan} payment=${razorpay_payment_id}`);

  return NextResponse.json({
    data: { plan, upgraded: true, payment_id: razorpay_payment_id,
      message: `Upgraded to ${plan}! Refresh to see new features.` },
  });
}

// GET /api/billing — current plan + usage stats
export const GET = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const { auth, error, status } = await authorize(supabase, { requiredPermission: "view_dashboard" });
  if (!auth) return NextResponse.json({ error }, { status });

  const monthStart = new Date();
  monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);

  const [aiGen, testRuns, projects, members] = await Promise.all([
    supabase.from("ai_generations").select("*", { count: "exact", head: true }).eq("created_by", auth.user_id).gte("created_at", monthStart.toISOString()),
    supabase.from("test_runs").select("*", { count: "exact", head: true }).gte("created_at", monthStart.toISOString()),
    supabase.from("projects").select("*", { count: "exact", head: true }).eq("org_id", auth.org_id),
    supabase.from("users").select("*", { count: "exact", head: true }).eq("org_id", auth.org_id),
  ]);

  return NextResponse.json({
    data: {
      plan: auth.plan, limits: auth.limits,
      usage: {
        ai_generations: { used: aiGen.count || 0, limit: auth.limits.ai_generations },
        test_runs: { used: testRuns.count || 0, limit: auth.limits.test_runs },
        projects: { used: projects.count || 0, limit: auth.limits.projects },
        team_members: { used: members.count || 0, limit: auth.limits.team_members },
      },
    },
  });
}
