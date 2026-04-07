// ===========================================
// TESTARA — Webhook Signature Verification
// Verifies HMAC-SHA256 signatures on incoming webhooks
// ===========================================

import { createHmac } from "crypto";

export function verifyWebhookSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  if (!signature || !secret) return false;

  const expected = createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("hex");

  // Constant-time comparison to prevent timing attacks
  const sig = signature.replace("sha256=", "");
  if (sig.length !== expected.length) return false;

  let result = 0;
  for (let i = 0; i < sig.length; i++) {
    result |= sig.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return result === 0;
}
