/**
 * Server-side fetch wrapper that disables Next.js route-handler caching.
 *
 * Next.js 14 caches `fetch()` responses in App Router route handlers by
 * default, even for POST requests. When request bodies are identical the
 * cache key hashes the same, so successive calls return a frozen response.
 * This caused a production bug where OAuth refresh-token exchanges returned
 * the same stale access_token on every rotation, leaving connections
 * permanently broken once the first token expired (see lib/oauth-token.ts).
 *
 * All server-side calls to external APIs and to the Python runtime should go
 * through this helper. Never trust the platform's default cache semantics for
 * time-sensitive external calls.
 *
 * Out of scope: calls made via third-party SDKs (e.g. Anthropic, OpenAI) —
 * those SDKs manage their own transport.
 */
export function serverFetch(
  url: string | URL | Request,
  init: RequestInit = {},
): Promise<Response> {
  return fetch(url, { ...init, cache: "no-store" });
}
