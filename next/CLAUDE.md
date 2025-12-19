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
