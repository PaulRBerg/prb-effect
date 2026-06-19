import { Duration } from "effect";

/**
 * @category models
 */
export type CacheVisibility = "public" | "private" | "no-store";

/**
 * @category models
 */
export type CacheControlOptions = {
  readonly visibility: CacheVisibility;
  readonly maxAge?: Duration.DurationInput;
  readonly sMaxAge?: Duration.DurationInput;
  readonly staleWhileRevalidate?: Duration.DurationInput;
  readonly mustRevalidate?: boolean;
  readonly proxyRevalidate?: boolean;
  readonly immutable?: boolean;
  readonly noCache?: boolean;
};

/**
 * @category models
 */
export type CacheHeadersOptions = {
  readonly cacheControl?: CacheControlOptions;
  readonly cdnCacheControl?: CacheControlOptions;
  readonly vercelCdnCacheControl?: CacheControlOptions;
};

const toHeaderSeconds = (input: Duration.DurationInput): number =>
  Math.max(0, Math.ceil(Duration.toMillis(input) / 1000));

const serializeCacheControl = (options: CacheControlOptions): string => {
  if (options.visibility === "no-store") {
    return "no-store";
  }

  const directives: string[] = [options.visibility];

  if (options.noCache === true) {
    directives.push("no-cache");
  }
  if (options.maxAge !== undefined) {
    directives.push(`max-age=${toHeaderSeconds(options.maxAge)}`);
  }
  if (options.sMaxAge !== undefined) {
    directives.push(`s-maxage=${toHeaderSeconds(options.sMaxAge)}`);
  }
  if (options.staleWhileRevalidate !== undefined) {
    directives.push(`stale-while-revalidate=${toHeaderSeconds(options.staleWhileRevalidate)}`);
  }
  if (options.mustRevalidate === true) {
    directives.push("must-revalidate");
  }
  if (options.proxyRevalidate === true) {
    directives.push("proxy-revalidate");
  }
  if (options.immutable === true) {
    directives.push("immutable");
  }

  return directives.join(", ");
};

/**
 * Builds a `Cache-Control` header value.
 *
 * @category builders
 */
export const cacheControl = (options: CacheControlOptions): string =>
  serializeCacheControl(options);

/**
 * Builds a `CDN-Cache-Control` header value.
 *
 * @category builders
 */
export const cdnCacheControl = (options: CacheControlOptions): string =>
  serializeCacheControl(options);

/**
 * Builds a `Vercel-CDN-Cache-Control` header value.
 *
 * @category builders
 */
export const vercelCdnCacheControl = (options: CacheControlOptions): string =>
  serializeCacheControl(options);

/**
 * Merges cache headers with an existing `HeadersInit`.
 *
 * @category utils
 */
export function mergeCacheHeaders(
  headers: HeadersInit | undefined,
  cache: CacheHeadersOptions
): Headers {
  const merged = new Headers(headers);

  if (cache.cacheControl !== undefined) {
    merged.set("Cache-Control", cacheControl(cache.cacheControl));
  }
  if (cache.cdnCacheControl !== undefined) {
    merged.set("CDN-Cache-Control", cdnCacheControl(cache.cdnCacheControl));
  }
  if (cache.vercelCdnCacheControl !== undefined) {
    merged.set("Vercel-CDN-Cache-Control", vercelCdnCacheControl(cache.vercelCdnCacheControl));
  }

  return merged;
}

/**
 * Creates a JSON response with explicit cache headers.
 *
 * @category utils
 */
export function jsonWithCache<T>(
  body: T,
  cache: CacheHeadersOptions,
  init?: ResponseInit
): Response {
  return Response.json(body, {
    ...init,
    headers: mergeCacheHeaders(init?.headers, cache),
  });
}

/**
 * Clones an existing Response and applies explicit cache headers.
 *
 * @category utils
 */
export function responseWithCache(response: Response, cache: CacheHeadersOptions): Response;
/**
 * Creates a Response with explicit cache headers.
 *
 * @category utils
 */
export function responseWithCache(
  body: BodyInit | null,
  cache: CacheHeadersOptions,
  init?: ResponseInit
): Response;
export function responseWithCache(
  responseOrBody: Response | BodyInit | null,
  cache: CacheHeadersOptions,
  init?: ResponseInit
): Response {
  if (responseOrBody instanceof Response) {
    const response = responseOrBody.clone();
    return new Response(response.body, {
      headers: mergeCacheHeaders(response.headers, cache),
      status: response.status,
      statusText: response.statusText,
    });
  }

  return new Response(responseOrBody, {
    ...init,
    headers: mergeCacheHeaders(init?.headers, cache),
  });
}
