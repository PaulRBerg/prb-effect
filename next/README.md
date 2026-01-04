# effect-next

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
bun add effect-next effect @effect/platform
```

### Optional Dependencies

- `@mcrovero/effect-react-cache` for `effect-next/react-cache`
- `@effect/opentelemetry` for `effect-next/telemetry/otel`

## Quick Start

### 1. Route Handlers

Convert Next.js route handlers into Effect workflows:

```typescript
// app/api/users/[id]/route.ts
import { Next } from "effect-next/handlers";
import { Effect } from "effect";
import { RouteParams } from "effect-next/params";

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

import { runServerAction } from "effect-next/action";
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

import { useEffectMemo, useEffectNextRuntime } from "effect-next/react-hooks";
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
import { Next } from "effect-next/handlers";
import { RequestTimingMiddleware, makeRequestTimingMiddleware } from "effect-next/middleware/request-timing";
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
import { reactCache } from "effect-next/react-cache";
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
import { Next } from "effect-next/handlers";

const Route = Next.make("Route", layer);

export const GET = Route.build(() => effect);
export const POST = Route.build(() => effect);
```

### Server Actions

```typescript
import { runServerAction, runServerActionOrThrow } from "effect-next/action";

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
} from "effect-next/react-hooks";

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
import { reactCache } from "effect-next/react-cache";

const getUser = reactCache((id: string) => effect);
const user = await Effect.runPromise(getUser("user-1"));
```

### Headers & Cookies

```typescript
import { Headers, Cookies } from "effect-next/headers";

Effect.gen(function* () {
  const headers = yield* Headers;
  const userAgent = headers.get("user-agent");

  const cookies = yield* Cookies;
  const sessionId = cookies.get("sessionId");
});
```

### Params

```typescript
import { RouteParams, SearchParams } from "effect-next/params";

Effect.gen(function* () {
  const params = yield* RouteParams;
  const userId = params.id;

  const searchParams = yield* SearchParams;
  const page = searchParams.page;
});
```

### Navigation

```typescript
import { redirect, rewrite, notFound } from "effect-next/navigation";

Effect.gen(function* () {
  yield* redirect("/login");
  yield* rewrite("/new-path");
  yield* notFound();
});
```

### Environment

```typescript
import { isProduction, resolveEnvironment } from "effect-next/env";

const env = resolveEnvironment();
if (isProduction()) {
  console.log("Production:", env);
}
```

### Telemetry

```typescript
import { Effect } from "effect";
import { createTelemetryLayer, TelemetryService } from "effect-next/telemetry";

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
} from "effect-next/testing-kit";

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

## Project Structure

```
effect-next/
├── src/
│   ├── action/          # Server actions
│   ├── cache/           # Request-scoped cache
│   ├── env/             # Environment helpers
│   ├── handlers/        # Route handlers
│   ├── headers/         # Headers & cookies
│   ├── middleware/      # Middleware
│   ├── navigation/      # Navigation utilities
│   ├── params/          # Route & search params
│   ├── react-cache/     # React cache integration
│   ├── react-hooks/     # Client-side hooks
│   ├── runtime/         # Runtime utilities
│   ├── server-actions/  # Server action helpers
│   ├── telemetry/       # Telemetry adapters
│   ├── testing-kit/     # Testing utilities
├── tests/               # Test suite
├── package.json
├── tsconfig.json
└── README.md
```

## Examples

See the [examples](./examples) directory for complete examples:

- Basic route handlers
- Server actions with form handling
- Client components with hooks
- Middleware composition
- Testing patterns

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) for guidelines.

## License

MIT

## Related Projects

- [Effect](https://github.com/Effect-TS/effect) - The Effect runtime
- [Next.js](https://nextjs.org) - The React framework
- [effect-evm](https://github.com/PaulRBerg/prb-effect/tree/main/evm) - Effect integration for EVM

## Credits

Built by the Sablier team with inspiration from the Effect community.
