# @prb/effect-next

## Framework

- **Next.js**: v15+ (App Router)

## Architecture

effect-next bridges Effect-TS and Next.js, providing: route handlers, server actions, composable middleware (via
Layers), React hooks for client-side Effects, request-scoped cache utilities, services (headers, cookies, params),
navigation utilities, and a testing kit.

## Commands

```bash
bun run build       # Build
bun test            # Test
bun run type-check  # Type check
bun run lint        # Lint
bun run format      # Format
```

## Module Structure

```
src/
├── action/         # Server action utilities (runServerAction)
├── cache/          # Request-scoped cache utilities
├── env/            # Environment variable helpers
├── handlers/       # Route handlers (GET, POST, etc.)
├── headers/        # Headers and Cookies services
├── middleware/     # Composable middleware via Layers
├── navigation/     # Navigation utilities
├── params/         # Route/search params services
├── react-cache/    # React cache integration
├── react-hooks/    # Client-side Effect hooks
├── runtime/        # Effect runtime management
├── server-actions/ # Server action wrappers
├── telemetry/      # OpenTelemetry and Sentry integration
├── testing-kit/    # Test utilities (exported as effect-next/testing-kit)
└── index.ts        # Barrel exports
```

## Server/Client Boundaries

- `"use client"` directive for client-only files (hooks, browser APIs)
- `import "server-only"` for server-only files
- Place directives before imports

## Module Structure

- Internal utilities in `internal/` (not exported)
- Tests co-located with source (`*.test.ts`)

## Comments

- Use `/** */` (JSDoc) for public APIs with `@param`, `@returns`, `@example`
- Use `//` for inline logic explanations
- Use `@internal` for internal APIs
