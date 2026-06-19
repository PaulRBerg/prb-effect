import { describe, expect, it } from "@effect/vitest";

import {
  cacheControl,
  cdnCacheControl,
  jsonWithCache,
  mergeCacheHeaders,
  responseWithCache,
  vercelCdnCacheControl,
} from "./index.js";

describe("cache-control", () => {
  it("serializes duration inputs as delta seconds", () => {
    expect(
      cacheControl({
        maxAge: "1 minute",
        staleWhileRevalidate: "30 seconds",
        visibility: "public",
      })
    ).toBe("public, max-age=60, stale-while-revalidate=30");

    expect(
      cdnCacheControl({
        maxAge: "1500 millis",
        sMaxAge: "2 minutes",
        visibility: "public",
      })
    ).toBe("public, max-age=2, s-maxage=120");
  });

  it("omits undefined directives", () => {
    expect(
      cacheControl({
        maxAge: "5 minutes",
        visibility: "private",
      })
    ).toBe("private, max-age=300");
  });

  it("serializes no-store without extra directives", () => {
    expect(
      cacheControl({
        maxAge: "5 minutes",
        visibility: "no-store",
      })
    ).toBe("no-store");
  });

  it("keeps Vercel CDN headers distinct from browser cache headers", () => {
    const headers = mergeCacheHeaders(
      { "Content-Type": "application/json" },
      {
        cacheControl: { maxAge: "30 seconds", visibility: "private" },
        cdnCacheControl: { maxAge: "5 minutes", visibility: "public" },
        vercelCdnCacheControl: { maxAge: "10 minutes", visibility: "public" },
      }
    );

    expect(headers.get("Cache-Control")).toBe("private, max-age=30");
    expect(headers.get("CDN-Cache-Control")).toBe("public, max-age=300");
    expect(headers.get("Vercel-CDN-Cache-Control")).toBe("public, max-age=600");
    expect(headers.get("Content-Type")).toBe("application/json");
  });

  it("creates JSON responses with cache headers", async () => {
    const response = jsonWithCache(
      { ok: true },
      { cacheControl: { maxAge: "1 minute", visibility: "public" } },
      { status: 201 }
    );

    expect(response.status).toBe(201);
    expect(response.headers.get("Cache-Control")).toBe("public, max-age=60");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("applies cache headers to existing responses", async () => {
    const response = responseWithCache(
      new Response("image", { headers: { "Content-Type": "image/png" }, status: 200 }),
      {
        cacheControl: {
          immutable: true,
          maxAge: "1 hour",
          visibility: "public",
        },
      }
    );

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=3600, immutable");
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(await response.text()).toBe("image");
  });

  it("does not consume original response bodies", async () => {
    const original = new Response("image", {
      headers: { "Content-Type": "image/png" },
      status: 200,
    });
    const response = responseWithCache(original, {
      cacheControl: { maxAge: "1 hour", visibility: "public" },
    });

    expect(await response.text()).toBe("image");
    expect(await original.text()).toBe("image");
  });

  it("exports separate builders for CDN headers", () => {
    expect(vercelCdnCacheControl({ sMaxAge: "1 minute", visibility: "public" })).toBe(
      "public, s-maxage=60"
    );
  });
});
