/**
 * In-memory sliding-window rate limiter.
 *
 * Security control for credential endpoints (rules.md: brute-force and
 * credential-stuffing resistance). Keys are per-identifier and per-IP;
 * only FAILED attempts count, so legitimate users and NAT'd computer labs
 * (many students behind one school IP) are not punished for each other's
 * successes — a success clears that identifier's bucket.
 *
 * Deployment note: the window lives in this process's memory, which is
 * correct for this app's single-node deployment (school LAN / one server).
 * If the app is ever scaled horizontally, move `store` to a shared backend
 * (Redis/Upstash or a Supabase table with an RPC) — the call sites only
 * depend on this module's two functions.
 */

export interface RateLimitResult {
  ok: boolean;
  /** Seconds until the oldest hit leaves the window (0 when ok). */
  retryAfterSec: number;
}

const store = new Map<string, number[]>();

/** Bounds the map against key-space floods (e.g. random identifiers). */
const MAX_KEYS = 10_000;

function prune(timestamps: number[], now: number, windowMs: number): number[] {
  const cutoff = now - windowMs;
  let firstValid = 0;
  while (firstValid < timestamps.length && timestamps[firstValid] <= cutoff) {
    firstValid += 1;
  }
  return firstValid === 0 ? timestamps : timestamps.slice(firstValid);
}

/**
 * Record a failed attempt against `key` and report whether it is allowed
 * to keep trying.
 *
 * @param key      bucket key, e.g. `login:id:qa-test` or `login:ip:10.0.0.2`
 * @param max      allowed failures within the window
 * @param windowMs sliding window length in ms
 */
export function failRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();

  // Lazy sweep when the key space grows too large: drop expired buckets.
  if (store.size >= MAX_KEYS) {
    for (const [k, hits] of store) {
      if (prune(hits, now, windowMs).length === 0) store.delete(k);
    }
    if (store.size >= MAX_KEYS) {
      // Still full (active attack) — keep the most recent buckets only.
      const entries = [...store.entries()].sort((a, b) => b[1][b[1].length - 1] - a[1][a[1].length - 1]);
      store.clear();
      entries.slice(0, MAX_KEYS / 2).forEach(([k, v]) => store.set(k, v));
    }
  }

  const hits = prune(store.get(key) ?? [], now, windowMs);
  hits.push(now);
  store.set(key, hits);

  if (hits.length > max) {
    const oldest = hits[0];
    const retryAfterSec = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Whether `key` is currently blocked (without recording a new attempt). */
export function checkRateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  const hits = prune(store.get(key) ?? [], now, windowMs);
  if (hits.length === 0) {
    if (store.has(key)) store.delete(key);
    return { ok: true, retryAfterSec: 0 };
  }
  store.set(key, hits);
  if (hits.length > max) {
    const retryAfterSec = Math.max(1, Math.ceil((hits[0] + windowMs - now) / 1000));
    return { ok: false, retryAfterSec };
  }
  return { ok: true, retryAfterSec: 0 };
}

/** Clear a bucket — call after a successful sign-in for that identifier. */
export function clearRateLimit(key: string): void {
  store.delete(key);
}

/** Human-readable wait copy for login errors. */
export function formatRetryAfter(retryAfterSec: number): string {
  if (retryAfterSec < 60) return `${retryAfterSec} seconds`;
  const minutes = Math.ceil(retryAfterSec / 60);
  return `${minutes} minute${minutes === 1 ? "" : "s"}`;
}
