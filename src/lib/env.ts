// ===========================================
// TESTARA — Environment Validation
// Import this at app startup to catch missing env vars early
// ===========================================

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `\n\n❌ Missing required environment variable: ${name}\n` +
      `   Copy .env.example to .env.local and fill in all required values.\n` +
      `   See README.md for setup instructions.\n\n`
    );
  }
  return value;
}

function optionalEnv(name: string, defaultValue = ""): string {
  return process.env[name] || defaultValue;
}

// Validate at import time (server-side only)
export const env = {
  // Required
  SUPABASE_URL: typeof window === "undefined" ? requireEnv("NEXT_PUBLIC_SUPABASE_URL") : process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  SUPABASE_ANON_KEY: typeof window === "undefined" ? requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY") : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "",
  SUPABASE_SERVICE_KEY: typeof window === "undefined" ? requireEnv("SUPABASE_SERVICE_ROLE_KEY") : "",
  ANTHROPIC_API_KEY: typeof window === "undefined" ? requireEnv("ANTHROPIC_API_KEY") : "",

  // Optional
  RAZORPAY_KEY_ID: optionalEnv("RAZORPAY_KEY_ID"),
  RAZORPAY_KEY_SECRET: optionalEnv("RAZORPAY_KEY_SECRET"),
  SLACK_WEBHOOK_URL: optionalEnv("SLACK_WEBHOOK_URL"),
  APP_URL: optionalEnv("NEXT_PUBLIC_APP_URL", "http://localhost:3000"),
  CRON_SECRET: optionalEnv("CRON_SECRET"),
  LOG_LEVEL: optionalEnv("LOG_LEVEL", "info"),
};
