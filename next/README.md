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
- **Request Timing Middleware** - Measure request duration with opt-in hooks
- **Environment Helpers** - Minimal NODE_ENV helpers with injectable resolver
- **Telemetry Adapters** - Optional Sentry + OTLP helpers (no defaults)
- **Headers & Cookies** - Access Next.js headers and cookies as Effect services
- **Params** - Type-safe route and search params
- **Navigation** - Effect-based navigation utilities
- **Testing Kit** - Comprehensive testing utilities for Effect-based Next.js apps

## Installation

```bash
bun add @prb/effect-next effect @effect/platform
```

### Optional Dependencies

- `@effect/opentelemetry` for `@prb/effect-next/telemetry/otel`

## Quick Start

### 1. Route Handlers

Convert Next.js route handlers into Effect workflows:

```typescript
// app/api/users/[id]/route.ts
import { Next } from "@prb/effect-next/handlers";
import { Effect } from "effect";
import { RouteParams } from "@prb/effect-next/params";

const Route = Next.make("UsersRoute", AppLayer);

export const GET = Route.build(() =>
  Effect.gen(function* () {
    const params = yield* RouteParams;
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
  const headers = yield* Headers;
  const userAgent = headers.get("user-agent");

  const cookies = yield* Cookies;
  const sessionId = cookies.get("sessionId");
});
```

### Params

```typescript
import { RouteParams, SearchParams } from "@prb/effect-next/params";

Effect.gen(function* () {
  const params = yield* RouteParams;
  const userId = params.id;

  const searchParams = yield* SearchParams;
  const page = searchParams.page;
});
```

### Navigation

```typescript
import { redirect, rewrite, notFound } from "@prb/effect-next/navigation";

Effect.gen(function* () {
  yield* redirect("/login");
  yield* rewrite("/new-path");
  yield* notFound();
});
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
