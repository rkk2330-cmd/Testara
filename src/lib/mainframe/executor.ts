// ===========================================
// TESTARA — Mainframe Step Executor
// Handles mainframe_* action types within test flows
// Enables web + mainframe in ONE test case
// ===========================================

import {
  MainframeSession,
  highSpeedEntry,
  compareScreenToWebData,
  type MainframeConnection,
  type ScreenState,
} from "@/lib/mainframe/terminal";

interface MainframeStepDef {
  action_type: string;
  target: {
    selector: string; // For mainframe: field_id, field_label, or row:col
    description: string;
  };
  input_data?: string | null;
  expected_result?: string | null;
}

interface MainframeStepResult {
  status: "passed" | "failed";
  screen_text: string;
  error_message: string | null;
  duration_ms: number;
}

// Active session for a test run
let activeSession: MainframeSession | null = null;

export async function executeMainframeStep(
  step: MainframeStepDef,
  connectionConfig?: MainframeConnection
): Promise<MainframeStepResult> {
  const startTime = Date.now();

  try {
    switch (step.action_type) {
      case "mainframe_connect": {
        if (!connectionConfig) throw new Error("Connection config required for mainframe_connect");
        activeSession = new MainframeSession(connectionConfig);
        await activeSession.connect();
        return {
          status: "passed",
          screen_text: activeSession.captureScreen(),
          error_message: null,
          duration_ms: Date.now() - startTime,
        };
      }

      case "mainframe_navigate": {
        if (!activeSession?.isConnected()) throw new Error("Not connected to mainframe");
        const command = step.input_data || step.target.selector;
        await activeSession.navigate(command);
        return {
          status: "passed",
          screen_text: activeSession.captureScreen(),
          error_message: null,
          duration_ms: Date.now() - startTime,
        };
      }

      case "mainframe_type": {
        if (!activeSession?.isConnected()) throw new Error("Not connected to mainframe");
        const value = step.input_data || "";
        const fieldLabel = step.target.selector;

        if (fieldLabel) {
          await activeSession.typeByLabel(fieldLabel, value);
        } else {
          await activeSession.type(value);
        }

        return {
          status: "passed",
          screen_text: activeSession.captureScreen(),
          error_message: null,
          duration_ms: Date.now() - startTime,
        };
      }

      case "mainframe_send_key": {
        if (!activeSession?.isConnected()) throw new Error("Not connected to mainframe");
        const key = step.input_data || "ENTER";
        await activeSession.sendKey(key);
        return {
          status: "passed",
          screen_text: activeSession.captureScreen(),
          error_message: null,
          duration_ms: Date.now() - startTime,
        };
      }

      case "mainframe_assert": {
        if (!activeSession?.isConnected()) throw new Error("Not connected to mainframe");
        const expected = step.expected_result || "";

        // Check if text exists anywhere on screen
        if (activeSession.screenContains(expected)) {
          return {
            status: "passed",
            screen_text: activeSession.captureScreen(),
            error_message: null,
            duration_ms: Date.now() - startTime,
          };
        }

        // Check specific position if selector is "row:col"
        const posMatch = step.target.selector.match(/^r?(\d+)[:\s,]c?(\d+)$/);
        if (posMatch) {
          const row = parseInt(posMatch[1]);
          const col = parseInt(posMatch[2]);
          const result = activeSession.assertText(row, col, expected);
          if (result.passed) {
            return {
              status: "passed",
              screen_text: activeSession.captureScreen(),
              error_message: null,
              duration_ms: Date.now() - startTime,
            };
          }
          throw new Error(`Expected "${expected}" at row ${row}, col ${col} but found "${result.actual}"`);
        }

        throw new Error(`Expected text "${expected}" not found on mainframe screen`);
      }

      case "mainframe_assert_field": {
        if (!activeSession?.isConnected()) throw new Error("Not connected to mainframe");
        const fieldLabel = step.target.selector;
        const expected = step.expected_result || "";
        const field = activeSession.getFieldByLabel(fieldLabel);

        if (!field) throw new Error(`Field "${fieldLabel}" not found on screen`);
        if (field.value?.trim() !== expected.trim()) {
          throw new Error(`Field "${fieldLabel}": expected "${expected}" but found "${field.value}"`);
        }

        return {
          status: "passed",
          screen_text: activeSession.captureScreen(),
          error_message: null,
          duration_ms: Date.now() - startTime,
        };
      }

      case "mainframe_high_speed": {
        if (!activeSession?.isConnected()) throw new Error("Not connected to mainframe");
        // Parse entries from input_data as JSON
        const entries = JSON.parse(step.input_data || "[]");
        await highSpeedEntry(activeSession, entries, "ENTER", 50);
        return {
          status: "passed",
          screen_text: activeSession.captureScreen(),
          error_message: null,
          duration_ms: Date.now() - startTime,
        };
      }

      case "mainframe_compare_web": {
        if (!activeSession?.isConnected()) throw new Error("Not connected to mainframe");
        const webData = JSON.parse(step.input_data || "{}");
        const screen = activeSession.getScreen();
        if (!screen) throw new Error("No screen data");

        const comparison = compareScreenToWebData(screen, webData);
        const mismatches = comparison.filter((c) => !c.match);

        if (mismatches.length > 0) {
          const details = mismatches.map((m) => `${m.field}: mainframe="${m.mainframe_value}" web="${m.web_value}"`).join("; ");
          throw new Error(`Data mismatch between web and mainframe: ${details}`);
        }

        return {
          status: "passed",
          screen_text: activeSession.captureScreen(),
          error_message: null,
          duration_ms: Date.now() - startTime,
        };
      }

      case "mainframe_disconnect": {
        if (activeSession) {
          await activeSession.disconnect();
          activeSession = null;
        }
        return {
          status: "passed",
          screen_text: "Disconnected",
          error_message: null,
          duration_ms: Date.now() - startTime,
        };
      }

      default:
        throw new Error(`Unknown mainframe action: ${step.action_type}`);
    }
  } catch (error) {
    return {
      status: "failed",
      screen_text: activeSession?.captureScreen() || "NO SCREEN",
      error_message: (error as Error).message,
      duration_ms: Date.now() - startTime,
    };
  }
}

// Cleanup session if test ends
export async function cleanupMainframeSession(): Promise<void> {
  if (activeSession) {
    await activeSession.disconnect();
    activeSession = null;
  }
}
