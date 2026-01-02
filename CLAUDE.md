# prb-effect Development Guidelines

AI agents working on prb-effect MUST follow these guidelines.

## Tech Stack

- **Effect**: Effect-TS v3.x
- **Language**: TypeScript v5.9+
- **Package Manager**: Bun with workspace catalogs
- **Task Runner**: Just
- **Linter and Formatter**: Biome (JS/TS/JSON), Prettier (MD/YAML)
- **Testing**: Vitest with @effect/vitest

## Lint Rules

After generating code, run these commands **in order**:

1. **`na biome lint <files>`** — lint JS/TS/JSON (skip if none changed)
2. **`na tsgo --noEmit`** — verify TypeScript types

If any command fails, fix errors before continuing. Run `just biome-write` at the end.

## Monorepo Structure

```
prb-effect/
├── next/                # @prb/effect-next - Next.js integration
├── web3/                # @prb/effect-web3 - Web3/viem integration
├── xstate/              # @prb/effect-xstate - xState v5 workflows
├── package.json         # Root workspace with catalogs
└── justfile             # Task automation
```

## Commands

```bash
just full-check          # Run all code checks
just tu                  # Run unit tests
just next::build         # Build @prb/effect-next
just web3::build         # Build @prb/effect-web3
just xstate::build       # Build @prb/effect-xstate
```

## Code Standards

### Naming Conventions

- **Directories**: `kebab-case` (e.g., `react-hooks`)
- **Files**: `kebab-case` (e.g., `primitives.ts`), except `PascalCase` for React components

### TypeScript

- Prefer `type` over `interface`
- Use `function` declarations for named functions
- Avoid `any`; use `unknown` if type is truly unknown
- Use `readonly` for immutable properties
- Use `satisfies` operator for type-safe constants

### Effect Patterns

- Use `Effect.gen` for generator-based composition
- Tag errors with `_tag` for discriminated unions
- Use `Layer` for dependency injection
- Use `Effect.sync` for synchronous effects, `Effect.promise` for async
- Prefer `yield*` over `yield` for Effect operations

## Module Structure

- Implementation files + `index.ts` barrel export per module
- Internal utilities in `internal/` (not exported)
- Tests co-located with source (`*.test.ts`)

## Testing

- Use `@effect/vitest` for Effect-specific matchers
- Test both success and failure cases
- Use descriptive test names

## Error Handling

- Tag errors with `_tag` for discriminated unions
- Use `Effect.fail` for expected errors, `Effect.die` for bugs

## No Backward Compatibility

These libraries do NOT require backward compatibility. Make breaking changes freely.
