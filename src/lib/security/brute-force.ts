// ===========================================
// TESTARA — Brute Force Protection
// Rate limits auth attempts per IP
// ===========================================

const attempts: Map<string, { count: number; firstAttempt: number; lockedUntil: number }> = new Map();

const MAX_ATTEMPTS = 5;
const WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes lockout

export function checkBruteForce(ip: string): { allowed: boolean; remaining: number; lockedUntil?: number } {
  const now = Date.now();
  const record = attempts.get(ip);

  if (!record) {
    attempts.set(ip, { count: 1, firstAttempt: now, lockedUntil: 0 });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  // Currently locked out
  if (record.lockedUntil > now) {
    return { allowed: false, remaining: 0, lockedUntil: record.lockedUntil };
  }

  // Window expired — reset
  if (now - record.firstAttempt > WINDOW_MS) {
    attempts.set(ip, { count: 1, firstAttempt: now, lockedUntil: 0 });
    return { allowed: true, remaining: MAX_ATTEMPTS - 1 };
  }

  // Within window
  record.count++;

  if (record.count > MAX_ATTEMPTS) {
    record.lockedUntil = now + LOCKOUT_MS;
    return { allowed: false, remaining: 0, lockedUntil: record.lockedUntil };
  }

  return { allowed: true, remaining: MAX_ATTEMPTS - record.count };
}

export function resetBruteForce(ip: string): void {
  attempts.delete(ip);
}

// Cleanup old entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [ip, record] of attempts) {
    if (now - record.firstAttempt > WINDOW_MS && record.lockedUntil < now) {
      attempts.delete(ip);
    }
  }
}, 10 * 60 * 1000);
