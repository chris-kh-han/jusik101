/**
 * In-memory sliding window rate limiter
 * Vercel serverless 환경에서는 인스턴스별로 독립적이지만,
 * 초기 단계에서는 충분한 보호 수준을 제공합니다.
 * 추후 Upstash Redis로 교체 가능.
 */

interface RateLimitEntry {
  readonly timestamps: readonly number[];
}

const store = new Map<string, RateLimitEntry>();
const WINDOW_MS = 60_000; // 1분
const MAX_REQUESTS = 60; // 분당 60회
const CLEANUP_INTERVAL_MS = 300_000; // 5분마다 정리

let lastCleanup = Date.now();

/**
 * Rate limit 체크
 * @returns true면 허용, false면 차단
 */
export function checkRateLimit(identifier: string): {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
} {
  cleanupIfNeeded();

  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  const entry = store.get(identifier);
  const validTimestamps = entry
    ? entry.timestamps.filter((t) => t > windowStart)
    : [];

  if (validTimestamps.length >= MAX_REQUESTS) {
    const oldestInWindow = validTimestamps[0] ?? now;
    const retryAfterMs = oldestInWindow + WINDOW_MS - now;

    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(retryAfterMs, 1000),
    };
  }

  store.set(identifier, {
    timestamps: [...validTimestamps, now],
  });

  return {
    allowed: true,
    remaining: MAX_REQUESTS - validTimestamps.length - 1,
    retryAfterMs: 0,
  };
}

/**
 * DART API 일일 호출 카운터
 */
let dailyCallCount = 0;
let dailyResetDate = new Date().toDateString();
const DAILY_LIMIT = 9_500; // 10,000 제한에 500 여유

export function checkDartApiLimit(): boolean {
  const today = new Date().toDateString();
  if (today !== dailyResetDate) {
    dailyCallCount = 0;
    dailyResetDate = today;
  }

  if (dailyCallCount >= DAILY_LIMIT) {
    return false;
  }

  dailyCallCount += 1;
  return true;
}

export function getDartApiCallCount(): number {
  return dailyCallCount;
}

/**
 * 오래된 rate limit 엔트리 정리
 */
function cleanupIfNeeded(): void {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL_MS) return;

  lastCleanup = now;
  const windowStart = now - WINDOW_MS;

  for (const [key, entry] of store.entries()) {
    const valid = entry.timestamps.filter((t) => t > windowStart);
    if (valid.length === 0) {
      store.delete(key);
    } else {
      store.set(key, { timestamps: valid });
    }
  }
}
