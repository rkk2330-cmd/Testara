// ===========================================
// TESTARA — Mainframe Terminal Emulation
// TN3270 (z/OS) + TN5250 (IBM i / AS400)
// ===========================================

import { Socket } from "net";
import { connect as tlsConnect } from "tls";

// ===== TERMINAL TYPES =====
export type TerminalType = "TN3270" | "TN5250";

export interface MainframeConnection {
  host: string;
  port: number;
  terminal_type: TerminalType;
  use_ssl: boolean;
  codepage?: string; // default EBCDIC 037
}

export interface ScreenField {
  row: number;
  col: number;
  length: number;
  value: string;
  is_input: boolean;
  is_protected: boolean;
  is_hidden: boolean;
  field_id: string; // generated: "r{row}c{col}"
  label?: string; // text preceding the field (auto-detected)
}

export interface ScreenState {
  rows: number;
  cols: number;
  cursor_row: number;
  cursor_col: number;
  screen_text: string[]; // array of row strings
  fields: ScreenField[];
  screen_name?: string; // detected from header/title area
  raw_buffer: string;
  timestamp: string;
}

// ===== 3270 AID KEYS =====
export const AID_KEYS = {
  ENTER: "\x7d",
  PF1: "\xf1", PF2: "\xf2", PF3: "\xf3", PF4: "\xf4",
  PF5: "\xf5", PF6: "\xf6", PF7: "\xf7", PF8: "\xf8",
  PF9: "\xf9", PF10: "\x7a", PF11: "\x7b", PF12: "\x7c",
  PF13: "\xc1", PF14: "\xc2", PF15: "\xc3", PF16: "\xc4",
  PF17: "\xc5", PF18: "\xc6", PF19: "\xc7", PF20: "\xc8",
  PF21: "\xc9", PF22: "\x4a", PF23: "\x4b", PF24: "\x4c",
  PA1: "\x6c", PA2: "\x6e", PA3: "\x6b",
  CLEAR: "\x6d",
  TAB: "\x05",
  BACKTAB: "\x04",
  HOME: "\x00",
  ATTN: "\xff\xf9",
  SYSREQ: "\xff\xef",
} as const;

// ===== EBCDIC <-> ASCII CONVERSION =====
const EBCDIC_TO_ASCII = new Map<number, number>();
const ASCII_TO_EBCDIC = new Map<number, number>();

// Standard EBCDIC-037 mapping (most common US/international)
const MAPPING: [number, number][] = [
  [0x40, 0x20], // space
  [0x4b, 0x2e], // .
  [0x4c, 0x3c], // <
  [0x4d, 0x28], // (
  [0x4e, 0x2b], // +
  [0x50, 0x26], // &
  [0x5a, 0x21], // !
  [0x5b, 0x24], // $
  [0x5c, 0x2a], // *
  [0x5d, 0x29], // )
  [0x5e, 0x3b], // ;
  [0x60, 0x2d], // -
  [0x61, 0x2f], // /
  [0x6b, 0x2c], // ,
  [0x6d, 0x5f], // _
  [0x6e, 0x3e], // >
  [0x6f, 0x3f], // ?
  [0x7a, 0x3a], // :
  [0x7b, 0x23], // #
  [0x7c, 0x40], // @
  [0x7d, 0x27], // '
  [0x7e, 0x3d], // =
  [0x7f, 0x22], // "
  // Lowercase a-z
  [0x81, 0x61], [0x82, 0x62], [0x83, 0x63], [0x84, 0x64],
  [0x85, 0x65], [0x86, 0x66], [0x87, 0x67], [0x88, 0x68],
  [0x89, 0x69], [0x91, 0x6a], [0x92, 0x6b], [0x93, 0x6c],
  [0x94, 0x6d], [0x95, 0x6e], [0x96, 0x6f], [0x97, 0x70],
  [0x98, 0x71], [0x99, 0x72], [0xa2, 0x73], [0xa3, 0x74],
  [0xa4, 0x75], [0xa5, 0x76], [0xa6, 0x77], [0xa7, 0x78],
  [0xa8, 0x79], [0xa9, 0x7a],
  // Uppercase A-Z
  [0xc1, 0x41], [0xc2, 0x42], [0xc3, 0x43], [0xc4, 0x44],
  [0xc5, 0x45], [0xc6, 0x46], [0xc7, 0x47], [0xc8, 0x48],
  [0xc9, 0x49], [0xd1, 0x4a], [0xd2, 0x4b], [0xd3, 0x4c],
  [0xd4, 0x4d], [0xd5, 0x4e], [0xd6, 0x4f], [0xd7, 0x50],
  [0xd8, 0x51], [0xd9, 0x52], [0xe2, 0x53], [0xe3, 0x54],
  [0xe4, 0x55], [0xe5, 0x56], [0xe6, 0x57], [0xe7, 0x58],
  [0xe8, 0x59], [0xe9, 0x5a],
  // Digits 0-9
  [0xf0, 0x30], [0xf1, 0x31], [0xf2, 0x32], [0xf3, 0x33],
  [0xf4, 0x34], [0xf5, 0x35], [0xf6, 0x36], [0xf7, 0x37],
  [0xf8, 0x38], [0xf9, 0x39],
];

MAPPING.forEach(([e, a]) => {
  EBCDIC_TO_ASCII.set(e, a);
  ASCII_TO_EBCDIC.set(a, e);
});

function ebcdicToAscii(buffer: Buffer): string {
  return Array.from(buffer)
    .map((b) => String.fromCharCode(EBCDIC_TO_ASCII.get(b) || 0x20))
    .join("");
}

function asciiToEbcdic(text: string): Buffer {
  return Buffer.from(
    Array.from(text).map((c) => ASCII_TO_EBCDIC.get(c.charCodeAt(0)) || 0x40)
  );
}

// ===== MAINFRAME SESSION =====
export class MainframeSession {
  private socket: Socket | null = null;
  private config: MainframeConnection;
  private screenBuffer: Buffer = Buffer.alloc(0);
  private currentScreen: ScreenState | null = null;
  private connected: boolean = false;
  private rows: number = 24;
  private cols: number = 80;
  private dataListeners: Array<(screen: ScreenState) => void> = [];

  constructor(config: MainframeConnection) {
    this.config = config;
    if (config.terminal_type === "TN5250") {
      this.rows = 24;
      this.cols = 80;
    }
  }

  // Connect to mainframe
  async connect(): Promise<ScreenState> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Connection timeout (30s)")), 30000);

      const onConnect = () => {
        clearTimeout(timeout);
        this.connected = true;

        // TN3270 negotiation
        this.sendTelnetNegotiation();
      };

      if (this.config.use_ssl) {
        this.socket = tlsConnect(
          { host: this.config.host, port: this.config.port, rejectUnauthorized: false },
          onConnect
        ) as unknown as Socket;
      } else {
        this.socket = new Socket();
        this.socket.connect(this.config.port, this.config.host, onConnect);
      }

      // Handle incoming data
      let firstScreen = true;
      this.socket.on("data", (data: Buffer) => {
        this.handleIncomingData(data);

        if (firstScreen && this.currentScreen) {
          firstScreen = false;
          clearTimeout(timeout);
          resolve(this.currentScreen);
        }
      });

      this.socket.on("error", (err) => {
        clearTimeout(timeout);
        this.connected = false;
        reject(new Error(`Connection failed: ${err.message}`));
      });

      this.socket.on("close", () => {
        this.connected = false;
      });
    });
  }

  // TN3270 telnet negotiation
  private sendTelnetNegotiation() {
    if (!this.socket) return;

    // IAC DO TN3270E or basic TN3270
    const negotiate = Buffer.from([
      0xff, 0xfb, 0x18, // IAC WILL TERMINAL-TYPE
      0xff, 0xfb, 0x19, // IAC WILL EOR
      0xff, 0xfb, 0x00, // IAC WILL BINARY
    ]);
    this.socket.write(negotiate);

    // Send terminal type
    const termType = this.config.terminal_type === "TN3270"
      ? "IBM-3278-2-E"
      : "IBM-3179-2";

    const typeResponse = Buffer.from([
      0xff, 0xfa, 0x18, 0x00, // IAC SB TERMINAL-TYPE IS
      ...Buffer.from(termType),
      0xff, 0xf0, // IAC SE
    ]);
    this.socket.write(typeResponse);
  }

  // Parse incoming 3270 data stream
  private handleIncomingData(data: Buffer) {
    // Filter out telnet negotiation bytes
    const cleanData = this.filterTelnet(data);
    if (cleanData.length === 0) return;

    // Append to screen buffer
    this.screenBuffer = Buffer.concat([this.screenBuffer, cleanData]);

    // Parse screen
    this.currentScreen = this.parseScreen(this.screenBuffer);

    // Notify listeners
    this.dataListeners.forEach((listener) => listener(this.currentScreen!));
  }

  // Filter telnet IAC sequences
  private filterTelnet(data: Buffer): Buffer {
    const filtered: number[] = [];
    let i = 0;
    while (i < data.length) {
      if (data[i] === 0xff) {
        // IAC - skip telnet commands
        if (i + 1 < data.length) {
          const cmd = data[i + 1];
          if (cmd === 0xfa) {
            // Subnegotiation — skip until IAC SE (0xff 0xf0)
            i += 2;
            while (i < data.length - 1 && !(data[i] === 0xff && data[i + 1] === 0xf0)) i++;
            i += 2;
          } else if (cmd >= 0xfb && cmd <= 0xfe) {
            i += 3; // WILL/WONT/DO/DONT + option
          } else {
            i += 2;
          }
        } else {
          i++;
        }
      } else {
        filtered.push(data[i]);
        i++;
      }
    }
    return Buffer.from(filtered);
  }

  // Parse buffer into screen state
  private parseScreen(buffer: Buffer): ScreenState {
    const screenText: string[] = [];
    const fields: ScreenField[] = [];

    // Convert buffer to text rows
    const text = ebcdicToAscii(buffer);
    for (let row = 0; row < this.rows; row++) {
      const start = row * this.cols;
      const end = Math.min(start + this.cols, text.length);
      screenText.push(start < text.length ? text.substring(start, end).padEnd(this.cols) : " ".repeat(this.cols));
    }

    // Detect input fields (simplified — real 3270 uses field attributes)
    for (let row = 0; row < this.rows; row++) {
      const line = screenText[row];
      let inField = false;
      let fieldStart = -1;

      for (let col = 0; col < this.cols; col++) {
        const char = line[col];
        // Detect field boundaries by looking for underscores or sequences of spaces after labels
        if (char === "_" || (col > 0 && line[col - 1] === ":" && char === " ")) {
          if (!inField) {
            fieldStart = col;
            inField = true;
          }
        } else if (inField && char !== " " && char !== "_") {
          // End of field
          const label = line.substring(0, fieldStart).trim().split(/\s{2,}/).pop()?.trim() || "";
          fields.push({
            row,
            col: fieldStart,
            length: col - fieldStart,
            value: line.substring(fieldStart, col).trim(),
            is_input: true,
            is_protected: false,
            is_hidden: label.toLowerCase().includes("password"),
            field_id: `r${row}c${fieldStart}`,
            label,
          });
          inField = false;
        }
      }
      if (inField) {
        const label = line.substring(0, fieldStart).trim().split(/\s{2,}/).pop()?.trim() || "";
        fields.push({
          row,
          col: fieldStart,
          length: this.cols - fieldStart,
          value: line.substring(fieldStart).trim(),
          is_input: true,
          is_protected: false,
          is_hidden: label.toLowerCase().includes("password"),
          field_id: `r${row}c${fieldStart}`,
          label,
        });
      }
    }

    // Detect screen name from first non-empty line
    const screenName = screenText.find((l) => l.trim().length > 0)?.trim().split(/\s+/)[0] || undefined;

    return {
      rows: this.rows,
      cols: this.cols,
      cursor_row: 0,
      cursor_col: 0,
      screen_text: screenText,
      fields,
      screen_name: screenName,
      raw_buffer: buffer.toString("hex"),
      timestamp: new Date().toISOString(),
    };
  }

  // ===== ACTIONS =====

  // Send text to current cursor position
  async type(text: string): Promise<void> {
    if (!this.socket || !this.connected) throw new Error("Not connected");
    const ebcdic = asciiToEbcdic(text);
    this.socket.write(ebcdic);
    await this.waitForScreen(500);
  }

  // Type into a specific field
  async typeIntoField(fieldId: string, value: string): Promise<void> {
    const field = this.currentScreen?.fields.find((f) => f.field_id === fieldId);
    if (!field) throw new Error(`Field ${fieldId} not found on screen`);

    // Move cursor to field position
    await this.setCursor(field.row, field.col);
    // Clear field
    await this.sendKey("DELETE_FIELD");
    // Type value
    await this.type(value);
  }

  // Type into field by label text
  async typeByLabel(label: string, value: string): Promise<void> {
    const field = this.currentScreen?.fields.find(
      (f) => f.label?.toLowerCase().includes(label.toLowerCase())
    );
    if (!field) throw new Error(`Field with label "${label}" not found. Available: ${this.currentScreen?.fields.map((f) => f.label).join(", ")}`);

    await this.typeIntoField(field.field_id, value);
  }

  // Send AID key (Enter, PF1-PF24, PA1-PA3, etc.)
  async sendKey(key: string): Promise<ScreenState> {
    if (!this.socket || !this.connected) throw new Error("Not connected");

    const keyMap: Record<string, string> = {
      ...AID_KEYS,
      DELETE_FIELD: "\x00", // simplified
    };

    const keyByte = keyMap[key.toUpperCase()] || AID_KEYS.ENTER;
    this.socket.write(Buffer.from(keyByte, "binary"));

    // Wait for new screen
    return await this.waitForScreen(5000);
  }

  // Move cursor to position
  async setCursor(row: number, col: number): Promise<void> {
    if (!this.socket || !this.connected) throw new Error("Not connected");

    // SBA (Set Buffer Address) order
    const address = row * this.cols + col;
    const sba = Buffer.from([0x11, (address >> 6) & 0x3f | 0x40, (address & 0x3f) | 0x40]);
    this.socket.write(sba);
  }

  // Navigate to a screen (type command + Enter)
  async navigate(command: string): Promise<ScreenState> {
    await this.type(command);
    return await this.sendKey("ENTER");
  }

  // Wait for screen update
  private waitForScreen(timeoutMs: number): Promise<ScreenState> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.dataListeners = this.dataListeners.filter((l) => l !== listener);
        reject(new Error("Screen timeout — no response from mainframe"));
      }, timeoutMs);

      const listener = (screen: ScreenState) => {
        clearTimeout(timeout);
        this.dataListeners = this.dataListeners.filter((l) => l !== listener);
        resolve(screen);
      };

      this.dataListeners.push(listener);
    });
  }

  // Get current screen state
  getScreen(): ScreenState | null {
    return this.currentScreen;
  }

  // Read text at a specific position
  readText(row: number, col: number, length: number): string {
    if (!this.currentScreen) return "";
    const line = this.currentScreen.screen_text[row] || "";
    return line.substring(col, col + length).trim();
  }

  // Read entire screen as text
  readScreen(): string {
    if (!this.currentScreen) return "";
    return this.currentScreen.screen_text.join("\n");
  }

  // Check if specific text exists on screen
  screenContains(text: string): boolean {
    return this.readScreen().toLowerCase().includes(text.toLowerCase());
  }

  // Assert text at position
  assertText(row: number, col: number, expected: string): { passed: boolean; actual: string } {
    const actual = this.readText(row, col, expected.length);
    return { passed: actual === expected, actual };
  }

  // Get field value by label
  getFieldByLabel(label: string): ScreenField | undefined {
    return this.currentScreen?.fields.find(
      (f) => f.label?.toLowerCase().includes(label.toLowerCase())
    );
  }

  // Disconnect
  async disconnect(): Promise<void> {
    if (this.socket) {
      this.socket.destroy();
      this.socket = null;
    }
    this.connected = false;
    this.currentScreen = null;
    this.screenBuffer = Buffer.alloc(0);
  }

  isConnected(): boolean {
    return this.connected;
  }

  // Generate a text-based screenshot of the green screen
  captureScreen(): string {
    if (!this.currentScreen) return "NO SCREEN DATA";
    const border = "+" + "-".repeat(this.cols) + "+";
    const rows = this.currentScreen.screen_text.map((line) => "|" + line + "|");
    return [border, ...rows, border].join("\n");
  }
}

// ===== HIGH-SPEED DATA ENTRY =====
export async function highSpeedEntry(
  session: MainframeSession,
  entries: Array<{ field: string; value: string }>,
  submitKey: string = "ENTER",
  delayMs: number = 50
): Promise<ScreenState> {
  for (const entry of entries) {
    await session.typeByLabel(entry.field, entry.value);
    // Minimal delay between fields for stability
    await new Promise((r) => setTimeout(r, delayMs));
  }
  return await session.sendKey(submitKey);
}

// ===== SCREEN COMPARISON (for legacy modernization testing) =====
export function compareScreenToWebData(
  screen: ScreenState,
  webData: Record<string, string>
): Array<{ field: string; mainframe_value: string; web_value: string; match: boolean }> {
  const results: Array<{ field: string; mainframe_value: string; web_value: string; match: boolean }> = [];

  for (const [key, webValue] of Object.entries(webData)) {
    const field = screen.fields.find(
      (f) => f.label?.toLowerCase().includes(key.toLowerCase())
    );
    const mainframeValue = field?.value?.trim() || "";

    results.push({
      field: key,
      mainframe_value: mainframeValue,
      web_value: webValue,
      match: mainframeValue.toLowerCase() === webValue.toLowerCase(),
    });
  }

  return results;
}
