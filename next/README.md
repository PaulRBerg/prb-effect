# @prb/effect-next

> [!WARNING]
>
> This is experimental, beta software. It is provided "as is" without warranty of any kind, express or implied.

Effect integration for Next.js - build type-safe, composable Next.js applications with Effect.

## Features

- **Route Handlers** - Convert Next.js route handlers into Effect workflows
- **Server Actions** - Type-safe server actions with Effect error handling
- **Middleware** - Composable middleware using Effect layers
- **React Hooks** - Client-side hooks for running Effects in React components
- **Request-Scoped Cache** - Leverage React cache() with Effect for deduplication
- **Persistent Cache** - Storage-neutral cache-aside helpers with TTL and SWR
- **Cache-Control Helpers** - Typed builders for browser, CDN, and Vercel cache headers
- **Rate Limit Middleware** - Generic fixed-window middleware with pluggable storage
- **Request Timing Middleware** - Measure request duration with opt-in hooks
- **Environment Helpers** - Minimal NODE_ENV helpers with injectable resolver
- **Telemetry Adapters** - Optional Sentry + OTLP helpers (no defaults)
- **Headers & Cookies** - Access Next.js headers and cookies as Effect services
- **Params** - Type-safe route and search params
- **Navigation** - Effect-based navigation utilities
- **Testing Kit** - Comprehensive testing utilities for Effect-based Next.js apps

## Installation

```bash
bun add @prb/effect-next effect@^4.0.0
```

Version 2 requires Effect 4 and supports Next.js 15 or 16 with React and React DOM 18.2 or newer. HTTP and OTLP APIs
come from Effect itself; telemetry needs no separate platform or OpenTelemetry package.

### Migrating from 1.x

Use native Effect 4 service keys in application layers. The middleware `Tag` factory remains available and is backed by
`Context.Service`:

```typescript
import { Context, Effect } from "effect";
import { createStatefulContext } from "@prb/effect-next/runtime";

class Database extends Context.Service<Database, { readonly query: () => Effect.Effect<string> }>()("Database") {}

// createStatefulContext returns Effect<Context.Context<R>, E>.
const program = Effect.gen(function* () {
  const context = yield* createStatefulContext(runtime);
  return Context.get(context, Database);
});
```

Use `Schema.Codec<A, I, DecodingServices, EncodingServices>` or `Schema.ConstraintCodec` for codec annotations, and
`Schema.decodeUnknownEffect`, `Schema.decodeEffect`, and `Schema.encodeEffect` for execution. Parameter decoders retain
only decoding requirements; persistent cache effects retain both decoding and encoding requirements, alongside storage
requirements. `Duration.Input` replaces `Duration.DurationInput`.

The Effect-returning `reactCache` preserves the first caller's context and tracing span for each argument tuple. Effects
requiring `Scope.Scope` must be scoped before caching:

```typescript
import { reactCache } from "@prb/effect-next/react-cache";

const cached = reactCache(() => Effect.scoped(acquireAndUseResource));
```

OTLP helpers now expose `OtlpExporter.Flusher` when an exporter is configured. Pass `provideHttpClient: false` to keep a
custom `HttpClient` requirement; disabled layers and layers without configured exporters remain empty. A dynamic
`OtelLayerOptions` value conservatively retains the client requirement unless `provideHttpClient` is statically `true`.

```typescript
import { Effect } from "effect";
import { OtlpExporter } from "effect/observability";
import { createOtelLayer } from "@prb/effect-next/telemetry/otel";

const otel = createOtelLayer({
  resource: { serviceName: "my-next-app" },
  traces: { url: "http://localhost:4318/v1/traces" },
});
const flush = Effect.flatMap(OtlpExporter.Flusher, (exporters) => exporters.flush).pipe(Effect.provide(otel));
```

Effect 4's `NumberFromString` can decode non-finite values. Use `Schema.FiniteFromString` for route parameters that must
reject invalid or non-finite numbers. Server-action results continue to use `success: true | false`, and navigation
errors still trigger Next.js control flow at the handler boundary.

## Quick Start

### 1. Route Handlers

Convert Next.js route handlers into Effect workflows:

```typescript
// app/api/users/[id]/route.ts
import { Next } from "@prb/effect-next/handlers";
import { Effect } from "effect";

const Route = Next.make("UsersRoute", AppLayer);

export const GET = Route.build((_request: Request, context: { params: Promise<{ id: string }> }) =>
  Effect.gen(function* () {
    const params = yield* Effect.promise(() => context.params);
    const userId = params.id;

    const user = yield* fetchUser(userId);
    return Response.json(user);
  }),
);
```

### 2. Server Actions

Create type-safe server actions with automatic error handling:

```typescript
// app/actions.ts
"use server";

import { runServerAction } from "@prb/effect-next/action";
import { Effect } from "effect";

export async function createUser() {
  return runServerAction(
    Effect.gen(function* () {
      const db = yield* Database;
      const user = yield* db.insert(users).values({ name: "Alice" });
      return user;
    }).pipe(Effect.provide(AppLayer))
  );
}

// app/page.tsx
"use client";

import { createUser } from "./actions";

export default function Page() {
  const handleSubmit = async () => {
    const result = await createUser();
    if (result.success) {
      console.log("User created:", result.data);
      return;
    }
    console.error("Error:", result.error);
  };

  return <button onClick={handleSubmit}>Create User</button>;
}
```

### 3. React Hooks

Run Effects in client components:

```typescript
"use client";

import { useEffectMemo, useEffectNextRuntime } from "@prb/effect-next/react-hooks";
import { Effect } from "effect";

function UserProfile({ userId }: { userId: string }) {
  const runtime = useEffectNextRuntime();

  const user = useEffectMemo(
    () => Effect.gen(function* () {
      const api = yield* UserApi;
      return yield* api.getUser(userId);
    }),
    [userId],
    runtime
  );

  if (!user) return <div>Loading...</div>;
  return <div>{user.name}</div>;
}
```

### 4. Middleware

Compose middleware using Effect layers:

```typescript
import { Next } from "@prb/effect-next/handlers";
import { RequestTimingMiddleware, makeRequestTimingMiddleware } from "@prb/effect-next/middleware/request-timing";
import { Effect, Layer } from "effect";

const AppLayerWithTiming = Layer.mergeAll(AppLayer, makeRequestTimingMiddleware());
const Route = Next.make("RouteWithTiming", AppLayerWithTiming).middleware(RequestTimingMiddleware);

export const GET = Route.build(() =>
  Effect.gen(function* () {
    return Response.json({ ok: true });
  }),
);
```

### 5. Request-Scoped Cache

Use React's cache() with Effect for request deduplication:

```typescript
// lib/data.ts
import { reactCache } from "@prb/effect-next/react-cache";
import { Effect } from "effect";

export const getUser = reactCache((id: string) =>
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db.query("SELECT * FROM users WHERE id = ?", [id]);
  }).pipe(Effect.provide(AppLayer)),
);

// Multiple components can call getUser() in the same request
// but the query will only execute once
```

### 6. Persistent Cache

Use a storage-neutral cache-aside helper when data should survive beyond a single render request:

```typescript
import { cachedEffect, makeInMemoryPersistentCacheStore } from "@prb/effect-next/persistent-cache";
import { Effect, Schema } from "effect";

const store = makeInMemoryPersistentCacheStore();
const User = Schema.Struct({ id: Schema.String, name: Schema.String });

export const getUser = (id: string) =>
  cachedEffect(fetchUser(id), {
    key: `user:${id}`,
    schema: User,
    staleWhileRevalidate: "5 minutes",
    store,
    ttl: "1 minute",
  });
```

Production Redis, Upstash, KV, or SQL adapters should live in application code and implement the `PersistentCacheStore`
contract.

### 7. Cache-Control

Set browser and CDN cache headers explicitly in route handlers:

```typescript
import { jsonWithCache } from "@prb/effect-next/cache-control";

export const GET = () =>
  jsonWithCache(
    { ok: true },
    {
      cacheControl: { maxAge: "30 seconds", visibility: "private" },
      vercelCdnCacheControl: { maxAge: "5 minutes", visibility: "public" },
    },
  );
```

No helper applies implicit caching; choose `public`, `private`, or `no-store` for every header value.

### 8. Rate Limiting

Add fixed-window rate limiting with a pluggable store:

```typescript
import {
  RateLimitMiddleware,
  makeInMemoryRateLimitStore,
  makeRateLimitMiddleware,
  rateLimitKey,
} from "@prb/effect-next/middleware/rate-limit";
import { Next } from "@prb/effect-next/handlers";
import { Layer } from "effect";

const RateLimitLive = makeRateLimitMiddleware({
  key: rateLimitKey.combine(rateLimitKey.method(), rateLimitKey.path(), rateLimitKey.ip()),
  limit: 60,
  store: makeInMemoryRateLimitStore(),
  window: "1 minute",
});

const Route = Next.make("Route", Layer.mergeAll(AppLayer, RateLimitLive)).middleware(RateLimitMiddleware);
```

## API Reference

### Route Handlers

```typescript
import { Next } from "@prb/effect-next/handlers";

const Route = Next.make("Route", layer);

export const GET = Route.build(() => effect);
export const POST = Route.build(() => effect);
```

### Server Actions

```typescript
import { runServerAction, runServerActionOrThrow } from "@prb/effect-next/action";

export const myAction = () => runServerAction(effect.pipe(Effect.provide(layer)));
export const myActionOrThrow = () => runServerActionOrThrow(effect.pipe(Effect.provide(layer)));
```

### React Hooks

```typescript
import {
  EffectNextProvider,
  useEffectNextRuntime,
  useEffectMemo,
  useEffectOnce,
  useForkEffect,
  useStream,
  useStreamLatest,
  useSubscriptionRef,
} from "@prb/effect-next/react-hooks";

// Provide runtime to app
<EffectNextProvider runtime={runtime}>
  {children}
</EffectNextProvider>

// Access runtime in components
const runtime = useEffectNextRuntime();

// Run Effect with dependencies
const data = useEffectMemo(() => effect, [deps], runtime);

// Run Effect once on mount
const data = useEffectOnce(effect, runtime);

// Run Effect in background
useForkEffect(effect, runtime, [deps]);

// Subscribe to Stream
const values = useStream(stream, runtime);
const latest = useStreamLatest(stream, runtime, initialValue);

// Subscribe to SubscriptionRef
const value = useSubscriptionRef(ref, runtime);
```

### React Cache

```typescript
import { Effect } from "effect";
import { reactCache } from "@prb/effect-next/react-cache";

const getUser = reactCache((id: string) => effect);
const user = await Effect.runPromise(getUser("user-1"));
```

### Headers & Cookies

```typescript
import { Headers, Cookies } from "@prb/effect-next/headers";

Effect.gen(function* () {
  const headers = yield* Headers();
  const userAgent = headers.get("user-agent");

  const cookies = yield* Cookies();
  const sessionId = cookies.get("sessionId");
});
```

`Headers` and `Cookies` call Next.js dynamic request APIs. Reading them in Server Components or layouts opts the route
into dynamic rendering, so keep them out of root layouts that should stay static or CDN-cacheable.

### Params

```typescript
import { decodeParamsUnknown, decodeSearchParamsUnknown } from "@prb/effect-next/params";
import { Effect, Schema } from "effect";

const readParams = (props: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) =>
  Effect.gen(function* () {
    const params = yield* decodeParamsUnknown(Schema.Struct({ id: Schema.String }))(props.params);
    const searchParams = yield* decodeSearchParamsUnknown(Schema.Struct({ page: Schema.optional(Schema.String) }))(
      props.searchParams,
    );

    return { userId: params.id, page: searchParams.page };
  });
```

### Navigation

```typescript
import { Redirect, PermanentRedirect, NotFound } from "@prb/effect-next/navigation";

const requireLogin = Redirect("/login");
const movedPage = PermanentRedirect("/new-path");
const missingPage = NotFound;
```

### Environment

```typescript
import { isProduction, resolveEnvironment } from "@prb/effect-next/env";

const env = resolveEnvironment();
if (isProduction()) {
  console.log("Production:", env);
}
```

### Telemetry

```typescript
import { Effect } from "effect";
import { createTelemetryLayer, TelemetryService } from "@prb/effect-next/telemetry";

const layer = createTelemetryLayer({
  captureException: (error) => console.error(error),
  captureMessage: (message) => console.log(message),
});

const program = Effect.gen(function* () {
  const telemetry = yield* TelemetryService;
  yield* telemetry.captureMessage("Telemetry ready");
}).pipe(Effect.provide(layer));
```

## Vercel Cost Patterns

- Prefer request-scoped `reactCache` for duplicate work within one render and `persistent-cache` for expensive data that
  should survive across requests.
- Set cache headers deliberately with `cache-control`; keep browser and Vercel CDN behavior separate.
- Avoid reading `Headers` or `Cookies` in root layouts for geolocation, banners, or personalization. Prefer proxy-set
  cookies, route-level reads, or client leaves so static shells remain cacheable.
- On high-volume routes, configure request timing with `sampleRate`, `shouldRecord`, and `redactProps` to avoid logging
  full props or high-cardinality values.

### Testing Kit

```typescript
import {
  assertRight,
  assertLeft,
  expectTaggedFailure,
  expectDefect,
  runExpectSuccess,
  runExpectFailure,
  makeMockRuntime,
} from "@prb/effect-next/testing-kit";

// Test success cases
test("should succeed", async () => {
  const exit = await Effect.runPromiseExit(effect);
  const value = assertRight(exit);
  expect(value).toBe(42);
});

// Test failure cases
test("should fail with NotFound", async () => {
  const exit = await Effect.runPromiseExit(effect);
  expectTaggedFailure(exit, "NotFound");
});

// Run effects in tests
test("should create user", async () => {
  const user = await runExpectSuccess(createUser(), runtime);
  expect(user.name).toBe("Alice");
});
```

## Contributing

For package-specific commands and conventions, see [AGENTS.md](./AGENTS.md).

## License

MIT. See [LICENSE](../LICENSE).

## Related Projects

- [Effect](https://github.com/Effect-TS/effect) - The Effect runtime
- [Next.js](https://nextjs.org) - The React framework
- [@prb/effect-evm](https://github.com/PaulRBerg/prb-effect/tree/main/evm) - Effect integration for EVM

## Credits

Built by the Sablier team with inspiration from the Effect community.
