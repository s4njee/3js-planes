/**
 * model-cache.js — Persistent GLB model cache using the Cache API
 *
 * GLB files are binary assets typically 0.5–5 MB each, far too large for
 * localStorage (which has a ~5 MB total limit). The Cache API stores full
 * HTTP Response objects with no practical size ceiling and is available in
 * all modern browsers.
 *
 * Strategy:
 *  - Before fetching a model from the network, check the Cache API.
 *  - If a cached Response exists, clone it and return it to the caller.
 *  - If not, fetch from the network, cache the Response, then return it.
 *  - Stale entries can be invalidated by bumping CACHE_VERSION.
 *
 * This module is consumed by MonolithCanvas.jsx — the GLTFLoader is configured
 * to use `cachedFetch()` as its fetch implementation so that all model loads
 * are transparently cached.
 */

/**
 * Cache API storage name. Bump the version suffix to invalidate all cached
 * models (e.g. after re-exporting assets with different compression).
 */
const CACHE_NAME = 'monolith-models-v1';

/**
 * Opens (or creates) the named Cache.
 * Returns null if the Cache API is not available (e.g. insecure context).
 */
async function openModelCache() {
  try {
    return await caches.open(CACHE_NAME);
  } catch {
    // Cache API unavailable (insecure HTTP, or unsupported browser).
    return null;
  }
}

/**
 * A fetch wrapper that checks the Cache API before hitting the network.
 *
 * Usage with THREE.GLTFLoader:
 *   loader.load(url, onLoad, onProgress, onError)
 *
 * GLTFLoader internally uses `fetch()` for the initial request. We intercept
 * that by patching the loader's request flow. However, since GLTFLoader.load()
 * doesn't accept a custom fetch, we provide a standalone function that can be
 * called before `loader.load()` to pre-populate the browser's HTTP cache, or
 * used directly.
 *
 * @param {string} url — the fully resolved asset URL
 * @returns {Response} — a Response object (from cache or network)
 */
export async function cachedFetch(url) {
  const cache = await openModelCache();

  if (cache) {
    // Check for a cached response
    const cached = await cache.match(url);
    if (cached) {
      return cached;
    }
  }

  // Cache miss — fetch from the network
  const response = await fetch(url);

  if (response.ok && cache) {
    // Clone the response before caching — a Response body can only be consumed
    // once, so we cache the clone and return the original.
    try {
      await cache.put(url, response.clone());
    } catch {
      // Cache storage full — silently ignore, the fetch still succeeds.
    }
  }

  return response;
}

/**
 * Returns true when the model URL already exists in the persistent Cache API.
 *
 * @param {string} url — the fully resolved asset URL
 * @returns {Promise<boolean>}
 */
export async function hasCachedModel(url) {
  const cache = await openModelCache();

  if (!cache) return false;

  const cached = await cache.match(url);
  return Boolean(cached);
}

/**
 * Pre-warms the cache for a given URL. Useful for preloading the next/previous
 * model in a set without blocking the current load.
 *
 * @param {string} url — the fully resolved asset URL
 */
export async function prewarmCache(url) {
  const cache = await openModelCache();

  if (!cache) return;

  const existing = await cache.match(url);
  if (existing) return; // already cached

  try {
    const response = await fetch(url);
    if (response.ok) {
      await cache.put(url, response);
    }
  } catch {
    // Network error during prewarm — silently ignore.
  }
}

/**
 * Deletes all cached models. Useful for a manual cache-clear button or
 * when assets are updated and the old cache should be flushed.
 */
export async function clearModelCache() {
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // Cache API unavailable.
  }
}
