# effect-next

Effect integration for Next.js - build type-safe, composable Next.js applications with Effect.

## Features

- **Route Handlers** - Convert Next.js route handlers into Effect workflows
- **Server Actions** - Type-safe server actions with Effect error handling
- **Middleware** - Composable middleware using Effect layers
- **React Hooks** - Client-side hooks for running Effects in React components
- **Request-Scoped Cache** - Leverage React cache() with Effect for deduplication
- **Headers & Cookies** - Access Next.js headers and cookies as Effect services
- **Params** - Type-safe route and search params
- **Navigation** - Effect-based navigation utilities
- **Testing Kit** - Comprehensive testing utilities for Effect-based Next.js apps

## Installation

```bash
bun add effect-next effect @effect/platform
```

## Quick Start

### 1. Route Handlers

Convert Next.js route handlers into Effect workflows:

```typescript
// app/api/users/[id]/route.ts
import { GET } from "effect-next/handlers";
import { Effect } from "effect";
import { RouteParams } from "effect-next/params";

export const GET = effectHandler(
  Effect.gen(function* () {
    const params = yield* RouteParams;
    const userId = params.id;

    const user = yield* fetchUser(userId);
    return Response.json(user);
  }),
  AppLayer,
);
```

### 2. Server Actions

Create type-safe server actions with automatic error handling:

```typescript
// app/actions.ts
"use server";

import { effectAction } from "effect-next/action";
import { Effect } from "effect";

export const createUser = effectAction(
  Effect.gen(function* () {
    const db = yield* Database;
    const user = yield* db.insert(users).values({ name: "Alice" });
    return user;
  }),
  AppLayer
);

// app/page.tsx
import { createUser } from "./actions";

export default function Page() {
  const handleSubmit = async () => {
    const result = await createUser();
    if (result._tag === "Success") {
      console.log("User created:", result.value);
    } else {
      console.error("Error:", result.error);
    }
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
// middleware.ts
import { effectMiddleware } from "effect-next/middleware";
import { Effect, Layer } from "effect";

const AuthMiddleware = Layer.effect(
  AuthService,
  Effect.gen(function* () {
    const headers = yield* Headers;
    const token = headers.get("authorization");

    if (!token) {
      yield* Effect.fail({ _tag: "Unauthorized" });
    }

    return { validateToken: (token: string) => Effect.succeed(true) };
  }),
);

export const middleware = effectMiddleware(
  Effect.gen(function* () {
    const auth = yield* AuthService;
    yield* auth.validateToken(token);
    return NextResponse.next();
  }),
  AuthMiddleware,
);
```

### 5. Request-Scoped Cache

Use React's cache() with Effect for request deduplication:

```typescript
// lib/data.ts
import { reactCache } from "effect-next/cache";
import { Effect } from "effect";

const runtime = ManagedRuntime.make(AppLayer);

export const getUser = reactCache(
  Effect.gen(function* () {
    const db = yield* Database;
    return yield* db.query("SELECT * FROM users");
  }),
  runtime,
);

// Multiple components can call getUser() in the same request
// but the query will only execute once
```

## API Reference

### Route Handlers

```typescript
import { GET, POST, PUT, DELETE, PATCH } from "effect-next/handlers";

// Create a GET handler
export const GET = effectHandler(effect, layer);

// Create a POST handler
export const POST = effectHandler(effect, layer);
```

### Server Actions

```typescript
import { effectAction } from "effect-next/action";

export const myAction = effectAction(effect, layer);
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

### Cache

```typescript
import { reactCache, reactCacheFn, reactCacheWithKey } from "effect-next/cache";

// Cache an Effect
const getData = reactCache(effect, runtime);

// Cache a function
const getUserById = reactCacheFn((id: string) => effect, runtime);

// Cache with custom key
const getUser = reactCacheWithKey(
  (options) => effect,
  (options) => `user:${options.id}`,
  runtime,
);
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
│   ├── handlers/        # Route handlers
│   ├── headers/         # Headers & cookies
│   ├── middleware/      # Middleware
│   ├── navigation/      # Navigation utilities
│   ├── params/          # Route & search params
│   ├── react-cache/     # React cache integration
│   ├── react-hooks/     # Client-side hooks
│   ├── runtime/         # Runtime utilities
│   ├── testing-kit/     # Testing utilities
│   └── types/           # Shared types
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
- [effect-web3](https://github.com/sablier-labs/effect-web3) - Effect integration for web3

## Credits

Built by the Sablier team with inspiration from the Effect community.
