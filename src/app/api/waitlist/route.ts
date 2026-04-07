import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { withHandler, validate } from "@/lib/core";
import { z } from "zod";

const WaitlistSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(100).optional(),
  company: z.string().max(100).optional(),
});

export const POST = withHandler(async (request) => {
  const supabase = await createServerSupabase();
  const input = validate(WaitlistSchema, await request.json());

  const { error } = await supabase.from("waitlist").insert(input);
  if (error?.code === "23505") return NextResponse.json({ error: "Already on waitlist" }, { status: 409 });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ data: { joined: true } }, { status: 201 });
});
