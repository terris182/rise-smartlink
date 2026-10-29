/**
 * Tiny in-memory TTL cache (per serverless instance). WHI-2392.
 *
 * Why: app/[...slug]/page.js is `force-dynamic`, which makes Next ignore
 * `fetch(..., { next: { revalidate } })`, so the "cached 24h" Spotify lookups
 * were really hitting Spotify on every page view. A warm instance keeps this
 * Map between requests; a cold start simply refills it.
 */
export function createTtlCache({ max = 500, now = () => Date.now() } = {}) {
  const store = new Map();
  return {
    get(key) {
      const hit = store.get(key);
      if (!hit) return undefined;
      if (hit.expires <= now()) { store.delete(key); return undefined; }
      return hit.value;
    },
    set(key, value, ttlMs) {
      if (store.size >= max) store.delete(store.keys().next().value);
      store.set(key, { value, expires: now() + ttlMs });
    },
    clear() { store.clear(); },
    get size() { return store.size; },
  };
}

const inflight = new WeakMap();

/** Run `load()` once per key within the TTL; concurrent callers share one in-flight call. `ttlFor(result)` picks the TTL (short for misses). */
export async function cached(cache, key, load, ttlFor) {
  const hit = cache.get(key);
  if (hit !== undefined) return hit.value;
  let pending = inflight.get(cache);
  if (!pending) { pending = new Map(); inflight.set(cache, pending); }
  if (pending.has(key)) return pending.get(key);
  const p = (async () => {
    try {
      const value = await load();
      cache.set(key, { value }, ttlFor(value));
      return value;
    } finally {
      pending.delete(key);
    }
  })();
  pending.set(key, p);
  return p;
}
