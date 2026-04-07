import { MainframeCommandSchema } from "@/lib/core/validation";
import { authorize } from "@/lib/security/auth";
import { withHandler } from "@/lib/core";
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  MainframeSession,
  highSpeedEntry,
  compareScreenToWebData,
  type MainframeConnection,
  type ScreenState,
} from "@/lib/mainframe/terminal";

// Active sessions (in-memory for MVP — move to Redis in production)
const sessions = new Map<string, MainframeSession>();

// POST /api/mainframe/connect — establish mainframe session
export const POST = withHandler(async (request: NextRequest) => {
  const supabase = await createServerSupabase();
  const { auth, error: authErr, status: authStatus } = await authorize(supabase);
  if (!auth) return NextResponse.json({ error: authErr }, { status: authStatus });

  const body = validate(MainframeCommandSchema, await request.json());
  const { action } = body;

  // === CONNECT ===
  if (action === "connect") {
    const { host, port, terminal_type, use_ssl, project_id } = body;

    if (!host || !port) {
      return NextResponse.json({ error: "host and port are required" }, { status: 400 });
    }

    const config: MainframeConnection = {
      host,
      port: parseInt(port),
      terminal_type: terminal_type || "TN3270",
      use_ssl: use_ssl || false,
    };

    const session = new MainframeSession(config);

    try {
      const screen = await session.connect();
      const sessionId = `mf_${auth.user_id}_${Date.now()}`;
      sessions.set(sessionId, session);

      // Store session reference in DB
      if (project_id) {
        await supabase.from("mainframe_sessions").upsert({
          project_id,
          host: config.host,
          port: config.port,
          terminal_type: config.terminal_type,
          credentials_encrypted: { session_id: sessionId },
          last_connected: new Date().toISOString(),
        });
      }

      return NextResponse.json({
        data: {
          session_id: sessionId,
          screen: {
            text: screen.screen_text,
            fields: screen.fields,
            screen_name: screen.screen_name,
            rows: screen.rows,
            cols: screen.cols,
          },
          green_screen: session.captureScreen(),
        },
      });
    } catch (err) {
      return NextResponse.json({
        error: `Connection failed: ${(err as Error).message}`,
        hint: "Ensure the mainframe host is accessible from your network. For internal mainframes, you'll need the Testara CLI Agent (Phase 2).",
      }, { status: 502 });
    }
  }

  // === SEND KEY ===
  if (action === "send_key") {
    const { session_id, key } = body;
    const session = sessions.get(session_id);
    if (!session?.isConnected()) return NextResponse.json({ error: "Session not found or disconnected" }, { status: 404 });

    try {
      const screen = await session.sendKey(key);
      return NextResponse.json({
        data: {
          screen: { text: screen.screen_text, fields: screen.fields, screen_name: screen.screen_name },
          green_screen: session.captureScreen(),
        },
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // === TYPE TEXT ===
  if (action === "type") {
    const { session_id, text, field_label, field_id } = body;
    const session = sessions.get(session_id);
    if (!session?.isConnected()) return NextResponse.json({ error: "Session not found or disconnected" }, { status: 404 });

    try {
      if (field_label) {
        await session.typeByLabel(field_label, text);
      } else if (field_id) {
        await session.typeIntoField(field_id, text);
      } else {
        await session.type(text);
      }

      const screen = session.getScreen();
      return NextResponse.json({
        data: {
          screen: screen ? { text: screen.screen_text, fields: screen.fields, screen_name: screen.screen_name } : null,
          green_screen: session.captureScreen(),
        },
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // === NAVIGATE (type command + Enter) ===
  if (action === "navigate") {
    const { session_id, command } = body;
    const session = sessions.get(session_id);
    if (!session?.isConnected()) return NextResponse.json({ error: "Session not found or disconnected" }, { status: 404 });

    try {
      const screen = await session.navigate(command);
      return NextResponse.json({
        data: {
          screen: { text: screen.screen_text, fields: screen.fields, screen_name: screen.screen_name },
          green_screen: session.captureScreen(),
        },
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // === HIGH-SPEED ENTRY ===
  if (action === "high_speed_entry") {
    const { session_id, entries, submit_key, delay_ms } = body;
    const session = sessions.get(session_id);
    if (!session?.isConnected()) return NextResponse.json({ error: "Session not found or disconnected" }, { status: 404 });

    try {
      const startTime = Date.now();
      const screen = await highSpeedEntry(session, entries, submit_key || "ENTER", delay_ms || 50);
      const duration = Date.now() - startTime;

      return NextResponse.json({
        data: {
          screen: { text: screen.screen_text, fields: screen.fields, screen_name: screen.screen_name },
          green_screen: session.captureScreen(),
          entries_count: entries.length,
          duration_ms: duration,
          speed: `${entries.length} fields in ${duration}ms`,
        },
      });
    } catch (err) {
      return NextResponse.json({ error: (err as Error).message }, { status: 500 });
    }
  }

  // === COMPARE WITH WEB DATA (Green Screen ↔ GUI validation) ===
  if (action === "compare_web") {
    const { session_id, web_data } = body;
    const session = sessions.get(session_id);
    if (!session?.isConnected()) return NextResponse.json({ error: "Session not found or disconnected" }, { status: 404 });

    const screen = session.getScreen();
    if (!screen) return NextResponse.json({ error: "No screen data available" }, { status: 400 });

    const comparison = compareScreenToWebData(screen, web_data);
    const allMatch = comparison.every((c) => c.match);

    return NextResponse.json({
      data: {
        status: allMatch ? "passed" : "failed",
        comparisons: comparison,
        mismatches: comparison.filter((c) => !c.match),
        green_screen: session.captureScreen(),
      },
    });
  }

  // === READ SCREEN ===
  if (action === "read_screen") {
    const { session_id } = body;
    const session = sessions.get(session_id);
    if (!session?.isConnected()) return NextResponse.json({ error: "Session not found or disconnected" }, { status: 404 });

    const screen = session.getScreen();
    return NextResponse.json({
      data: {
        screen: screen ? { text: screen.screen_text, fields: screen.fields, screen_name: screen.screen_name } : null,
        green_screen: session.captureScreen(),
      },
    });
  }

  // === ASSERT TEXT ===
  if (action === "assert_text") {
    const { session_id, row, col, expected } = body;
    const session = sessions.get(session_id);
    if (!session?.isConnected()) return NextResponse.json({ error: "Session not found or disconnected" }, { status: 404 });

    const result = session.assertText(row, col, expected);
    return NextResponse.json({
      data: { ...result, row, col, expected },
    });
  }

  // === DISCONNECT ===
  if (action === "disconnect") {
    const { session_id } = body;
    const session = sessions.get(session_id);
    if (session) {
      await session.disconnect();
      sessions.delete(session_id);
    }
    return NextResponse.json({ data: { disconnected: true } });
  }

  return NextResponse.json({
    error: "Unknown action. Available: connect, send_key, type, navigate, high_speed_entry, compare_web, read_screen, assert_text, disconnect",
  }, { status: 400 });
}
