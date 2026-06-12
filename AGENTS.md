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

After generating code, run these commands **in order**.

**Command sequence:**

1. **Biome lint** — if JS/TS/JSON files changed
   - `na biome lint <files>`

2. **TypeScript check** — if TS files changed
   - Changed code in a single package? → `just type-check <package>`
   - Changed code across packages? → `just type-check-all`

3. **Run related tests** — if test files or test-related files changed
   - `na vitest <test-files>` — only run tests related to your changes, not the entire suite

If any command fails, fix errors before continuing.

## Monorepo Structure

```
prb-effect/
├── evm/                 # @prb/effect-evm - EVM/viem integration
├── evm-safe/            # @prb/effect-evm-safe - Safe Apps integration
├── next/                # @prb/effect-next - Next.js integration
├── solana/              # @prb/effect-solana - Solana integration
├── xstate/              # @prb/effect-xstate - xState v5 workflows
├── justfile             # Task automation
└── package.json         # Root workspace with catalogs
```

## Commands

```bash
just full-check          # Run all code checks (prettier + biome + type check)
just build <package>     # Build a single package (e.g., just build evm)
just build-all           # Build all packages (.tgz)
just type-check <package> # TypeScript type check a single package
just type-check-all      # TypeScript type check all packages
just tu                  # Run unit tests
just ti                  # Run integration tests
just clean               # Clean dist, tsbuildinfo, tgz artifacts
just evm::build          # Build @prb/effect-evm
just evm-safe::build     # Build @prb/effect-evm-safe
just next::build         # Build @prb/effect-next
just solana::build       # Build @prb/effect-solana
just xstate::build       # Build @prb/effect-xstate
```

## Environment Variables (dotenvx)

Secrets are managed with [dotenvx](https://dotenvx.com) (`@dotenvx/dotenvx`, root devDependency):

- **`.env`** — encrypted values + `DOTENV_PUBLIC_KEY`. Safe to commit; committed.
- **`.env.keys`** — `DOTENV_PRIVATE_KEY` used for decryption. Gitignored; NEVER commit it.

Rules:

- Integration tests (`just ti`) run through `dotenvx run`, which decrypts `.env` at runtime. Do not pass secrets via
  shell exports or plaintext env files.
- Add or update a secret with `na dotenvx set KEY value` (encrypts in place). Never write plaintext values into `.env`
  directly.
- Without `.env.keys`, dotenvx logs a `MISSING_PRIVATE_KEY` error and injects the literal `encrypted:...` string instead
  of the decrypted value. Code reading these vars must treat `encrypted:`-prefixed values as absent and degrade
  gracefully (see `evm-safe/src/safe/detection.test.integration.ts`).
- Current keys: `ROUTEMESH_API_KEY` — RouteMesh RPC load balancer (`https://lb.routeme.sh/rpc/CHAIN_ID/API_KEY`), used
  as the primary RPC in integration tests.
- CI does not use dotenvx: GitHub Actions injects `ROUTEMESH_API_KEY` from the repository secret of the same name (see
  `.github/workflows/_base.ci.yml`). dotenvx never overrides pre-set env vars, so a value from the shell or CI always
  wins over `.env`.

## Code Standards

### Naming Conventions

- **Directories**: `kebab-case` (e.g., `react-hooks`)
- **Files**: `kebab-case` (e.g., `primitives.ts`), except `PascalCase` for React components

### TypeScript

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
