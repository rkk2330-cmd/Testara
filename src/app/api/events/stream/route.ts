import { NextRequest } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { authorize } from "@/lib/security/auth";
import { addSSEClient, removeSSEClient } from "@/lib/events/workers";

// GET /api/events/stream — SSE endpoint for real-time notifications
export async function GET(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { auth } = await authorize(supabase);
  if (!auth) {
    return new Response("Unauthorized", { status: 401 });
  }

  const orgId = auth.org_id;

  const stream = new ReadableStream({
    start(controller) {
      // Send initial connection message
      const encoder = new TextEncoder();
      controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "connected", orgId })}\n\n`));

      // Register this client for push notifications
      addSSEClient(orgId, controller);

      // Heartbeat every 30 seconds to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: heartbeat\n\n`));
        } catch {
          clearInterval(heartbeat);
          removeSSEClient(controller);
        }
      }, 30000);

      // Cleanup on close
      request.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        removeSSEClient(controller);
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
