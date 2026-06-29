import { requestUrl } from "obsidian";
import type { PosterSize } from "./settings";
import type {
  TmdbCache,
  TmdbCacheEntry,
} from "./types";

const TMDB_BASE = "https://api.themoviedb.org/3";
const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p";
export const TMDB_CACHE_ENTRY_VERSION = 2 as const;

/**
 * One day in ms. Used for TTL math + jitter.
 */
const ONE_DAY_MS = 86_400_000;

/**
 * Per-entry random jitter applied to TMDB cache TTL. With ±5 days, 1000+
 * entries cached at the same time spread their expirations across a 10-day
 * window, so revalidation load is steady instead of bursty.
 */
const TMDB_CACHE_JITTER_MS = 5 * ONE_DAY_MS;

/**
 * Sentinel used inside `expires_at` for entries that should never expire.
 * Picked so that `Date.now() < expires_at` is always true within JS's safe
 * integer range (year ~275760).
 */
const NEVER_EXPIRES = Number.MAX_SAFE_INTEGER;

export interface TmdbMetadata {
  poster_url: string;
}

export interface TmdbMovieResponse {
  poster_path: string | null;
}

/**
 * Compose the cache key for an item. The legacy language arguments remain so
 * existing caches can still be read while this English-only fork settles.
 */
export function tmdbCacheKey(
  mediaType: "movie" | "tv",
  tmdbId: number,
  language: string,
  fallback: string = "",
): string {
  const langPart = language || "default";
  if (fallback) {
    return `${mediaType}:${tmdbId}:${langPart}:fb=${fallback}`;
  }
  return `${mediaType}:${tmdbId}:${langPart}`;
}

/**
 * Compute when a freshly written cache entry should expire.
 *
 * - `ttlDays === 0` → never expire (`Number.MAX_SAFE_INTEGER`)
 * - otherwise → `now + ttlDays + uniformRandom(±5 days)`, clamped to ≥ 1 day
 */
export function computeCacheExpiry(ttlDays: number, now = Date.now()): number {
  if (ttlDays <= 0) return NEVER_EXPIRES;
  const baseMs = ttlDays * ONE_DAY_MS;
  const jitterMs = (Math.random() - 0.5) * 2 * TMDB_CACHE_JITTER_MS;
  return now + Math.max(ONE_DAY_MS, baseMs + jitterMs);
}

/**
 * Pure-data check: is a given entry fresh, stale, or fully expired? Pulled
 * out of the fetch path so smoke tests can verify staleness logic without
 * mocking time-of-day.
 */
export function cacheEntryFreshness(
  entry: TmdbCacheEntry | undefined,
  now = Date.now(),
): "missing" | "fresh" | "stale" {
  if (!entry) return "missing";
  if (entry.cache_version !== TMDB_CACHE_ENTRY_VERSION) return "missing";
  return entry.expires_at > now ? "fresh" : "stale";
}

/**
 * Background revalidations are tracked here so that two concurrent fetches
 * for the same key don't issue duplicate API calls. Cleared when a
 * revalidation finishes (success or failure).
 */
const inFlightRevalidations = new Set<string>();

/**
 * Public entry point. Always cache-aware; see header comment in spec 0001
 * §A "Lazy revalidation". Behavior:
 *
 *   - cache hit + fresh    → return cached, no API call
 *   - cache hit + stale    → return cached immediately, fire-and-forget
 *                             a background fetch that updates the cache on
 *                             success (silently keeps stale on failure)
 *   - cache miss           → fetch synchronously, write the result, return
 *
 * The `cache` parameter is mutated in place — caller is expected to
 * `saveSettings()` after the surrounding sync run completes. We don't save
 * per-call to avoid serializing data.json hundreds of times during one sync.
 */
/**
 * [0.3.2] Verify a TMDB API key works by hitting `/configuration` — a
 * lightweight endpoint that returns image-base URLs and rate-limit info,
 * authenticated the same way as the real fetch endpoints we use elsewhere.
 *
 * Returns a discriminated union so callers can render the right message
 * without re-parsing error strings.
 *
 * Designed for a settings-tab "Test" button — runs once, never cached,
 * never touches the persistent TMDB cache. Empty input is a fast-path
 * `{ ok: false, reason: "empty" }` so the button can show a sensible
 * error without making a network call.
 */
export type TmdbVerifyResult =
  | { ok: true }
  | { ok: false; reason: "empty" | "unauthorized" | "network"; detail?: string };

export async function verifyTmdbApiKey(
  apiKey: string,
): Promise<TmdbVerifyResult> {
  const key = apiKey.trim();
  if (!key) return { ok: false, reason: "empty" };

  const url = `${TMDB_BASE}/configuration?api_key=${encodeURIComponent(key)}`;
  try {
    const response = await requestUrl({
      url,
      method: "GET",
      // `throw: false` so we can inspect the status code on 401/404 etc.
      // instead of catching a generic exception. TMDB returns 401 for an
      // invalid key (with a `status_message` JSON body) which is what we
      // want to surface verbatim to the user.
      throw: false,
    });
    if (response.status === 200) return { ok: true };
    if (response.status === 401 || response.status === 403) {
      // Try to extract TMDB's own "Invalid API key" message for the
      // tooltip — falls back to a generic string on parse failure.
      let detail: string | undefined;
      try {
        const body = response.json as { status_message?: string };
        detail = body?.status_message;
      } catch {
        /* ignore — detail stays undefined */
      }
      return { ok: false, reason: "unauthorized", detail };
    }
    return {
      ok: false,
      reason: "network",
      detail: `HTTP ${response.status}`,
    };
  } catch (e) {
    return {
      ok: false,
      reason: "network",
      detail: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function fetchMovieMetadata(
  tmdbId: number,
  apiKey: string,
  size: PosterSize,
  language: string,
  cache: TmdbCache,
  ttlDays: number,
  fallbackLanguage: string = "",
): Promise<TmdbMetadata> {
  return fetchTmdbMetadataCached(
    "movie",
    tmdbId,
    apiKey,
    size,
    language,
    cache,
    ttlDays,
    fallbackLanguage,
  );
}

export async function fetchTvMetadata(
  tmdbId: number,
  apiKey: string,
  size: PosterSize,
  language: string,
  cache: TmdbCache,
  ttlDays: number,
  fallbackLanguage: string = "",
): Promise<TmdbMetadata> {
  return fetchTmdbMetadataCached(
    "tv",
    tmdbId,
    apiKey,
    size,
    language,
    cache,
    ttlDays,
    fallbackLanguage,
  );
}

async function fetchTmdbMetadataCached(
  mediaType: "movie" | "tv",
  tmdbId: number,
  apiKey: string,
  size: PosterSize,
  language: string,
  cache: TmdbCache,
  ttlDays: number,
  fallbackLanguage: string = "",
): Promise<TmdbMetadata> {
  const key = tmdbCacheKey(mediaType, tmdbId, language, fallbackLanguage);
  const entry = cache[key];
  const freshness = cacheEntryFreshness(entry);

  if (freshness === "fresh" && entry) {
    // Hot path: every steady-state sync hits this for items we've already
    // seen. Zero API calls, zero await of network.
    return { poster_url: entry.poster_url };
  }

  if (freshness === "stale" && entry) {
    // Stale-while-revalidate: serve the cached value now, fire a
    // background fetch that updates the cache on success. If the
    // background fetch fails, the stale entry stays — user sees old data
    // until the next successful revalidation, but never sees an empty.
    if (!inFlightRevalidations.has(key)) {
      inFlightRevalidations.add(key);
      void revalidateInBackground(
        mediaType,
        tmdbId,
        apiKey,
        size,
        language,
        cache,
        ttlDays,
        key,
        fallbackLanguage,
      );
    }
    return { poster_url: entry.poster_url };
  }

  // Miss → fetch synchronously, write to cache.
  const fresh = await fetchTmdbMetadata(
    mediaType,
    tmdbId,
    apiKey,
    size,
    language,
    fallbackLanguage,
  );
  // Only cache successful fetches. A response that's both empty AND has no
  // poster suggests TMDB returned an error or we got rate-limited; we'd
  // rather retry next time than cache a placeholder.
  if (fresh.poster_url) {
    cache[key] = {
      cache_version: TMDB_CACHE_ENTRY_VERSION,
      poster_url: fresh.poster_url,
      translation: null,
      cached_at: Date.now(),
      expires_at: computeCacheExpiry(ttlDays),
    };
  }
  return fresh;
}

async function revalidateInBackground(
  mediaType: "movie" | "tv",
  tmdbId: number,
  apiKey: string,
  size: PosterSize,
  language: string,
  cache: TmdbCache,
  ttlDays: number,
  key: string,
  fallbackLanguage: string = "",
): Promise<void> {
  try {
    const fresh = await fetchTmdbMetadata(
      mediaType,
      tmdbId,
      apiKey,
      size,
      language,
      fallbackLanguage,
    );
    if (fresh.poster_url) {
      cache[key] = {
        cache_version: TMDB_CACHE_ENTRY_VERSION,
        poster_url: fresh.poster_url,
        translation: null,
        cached_at: Date.now(),
        expires_at: computeCacheExpiry(ttlDays),
      };
    }
    // Else: revalidation came back empty. Keep the existing stale entry.
  } catch (e) {
    console.warn(
      `TMDB background revalidation failed for ${key}; keeping stale entry`,
      e,
    );
  } finally {
    inFlightRevalidations.delete(key);
  }
}

/**
 * Drop every TMDB cache entry. Exposed so the settings UI button +
 * `Traktr: Clear TMDB cache` command can wire to the same call.
 */
export function clearTmdbCache(cache: TmdbCache): void {
  for (const k of Object.keys(cache)) delete cache[k];
}

/**
 * Cache observability for the settings UI. Returns the entry count + a
 * rough byte estimate for the description ("3,127 entries, ~1.5 MB").
 */
export function tmdbCacheStats(cache: TmdbCache): {
  entries: number;
  approxBytes: number;
} {
  const entries = Object.keys(cache).length;
  // Each entry is roughly: key string (40 chars) + 5 fields. Real measure
  // would require JSON.stringify which is expensive on large caches; this
  // estimate is good enough for UI rendering and avoids the perf hit.
  const approxBytes = entries * 500;
  return { entries, approxBytes };
}

// ─────────────────────────────────────────────────────────────────────
// Public callers use the cache-aware wrappers above.
// ─────────────────────────────────────────────────────────────────────

async function fetchTmdbMetadata(
  mediaType: "movie" | "tv",
  tmdbId: number,
  apiKey: string,
  size: PosterSize,
  language: string,
  fallbackLanguage: string = "",
): Promise<TmdbMetadata> {
  try {
    const params = new URLSearchParams({ api_key: apiKey });
    const resp = await requestUrl({
      url: `${TMDB_BASE}/${mediaType}/${tmdbId}?${params.toString()}`,
      method: "GET",
      headers: { "Content-Type": "application/json" },
      throw: false,
    });

    if (resp.status !== 200) {
      console.warn(
        `TMDB lookup failed for ${mediaType}/${tmdbId}: ${resp.status}`,
      );
      return { poster_url: "" };
    }

    const data = resp.json as TmdbMovieResponse;
    const poster_url = data.poster_path
      ? `${TMDB_IMAGE_BASE}/${size}${data.poster_path}`
      : "";
    return { poster_url };
  } catch (e) {
    console.warn(`TMDB lookup error for ${mediaType}/${tmdbId}:`, e);
    return { poster_url: "" };
  }
}
