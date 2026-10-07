# prb-effect Development Guidelines

Bun workspace of Effect 4 libraries published to npm as `@prb/effect-*`: `evm` (viem), `evm-safe` (Safe Apps; depends on
`evm`), `next` (Next.js), `solana`, and `xstate` (xState v5). Declare shared dependency versions in the root
`package.json` workspace catalogs and reference them with `catalog:` specifiers.

## Prerequisites and Setup

Install [Node.js](https://nodejs.org) v24 or v26+, [Bun](https://bun.sh), [Just](https://github.com/casey/just), and
[Ni](https://github.com/antfu-collective/ni) (`na`, `ni`, `nr`), then run `bun install` at the repository root.

## Commands

Root recipes:

```bash
just type-check <package>  # tsgo --noEmit in one package directory; no argument checks all packages
just tu [files]            # Unit tests across all packages (excludes *.test.integration.ts)
just ti [files]            # Integration tests, with .env decrypted by dotenvx
just full-check            # Biome, Prettier, and type checks
just full-write            # Biome and Prettier fixes
just build <package>       # Build one package; `just build-all` builds every package
```

Package recipes come from `recipes.just`. Run them inside a package directory or as `just <module>::<recipe>` from the
root; the `evm-safe` module is named `evm_safe` (for example, `just evm_safe::test-unit`). In a package, `just test`
runs unit and integration tests; use `just test-unit` for unit tests only.

## Lint Rules

After generating code, run these commands **in order**. If any command fails, fix errors before continuing.

1. **Biome lint** — if JS/TS/JSON files changed: `na biome lint <files>`
2. **TypeScript check** — if TS files changed: `just type-check <package>` for one package, `just type-check-all` for
   changes across packages
3. **Related tests** — if test files or test-related files changed: `na vitest run <test-files>`; do not run the entire
   suite

The pre-commit hook runs lint-staged, which formats staged files with Biome (JS/TS/JSON) and Prettier (MD/YAML).

## Contributing

External contributors fork the repository, branch from `main`, follow this file and the nearest package `AGENTS.md`, add
tests for new features or behavior changes, and pass `just full-check` and `just tu` before opening a pull request.

## Releases

- npm publishing runs only in `.github/workflows/release.yml`, through npm trusted publishing in staged mode. Never run
  `npm publish`, `npm stage approve`, or `npm stage reject` locally.
- To ship: bump the version and `CHANGELOG.md`, commit, create an annotated tag `<pkg>@X.Y.Z` (prerelease
  `<pkg>@X.Y.Z-beta.N`), push the commit, then push tags with `git push origin <tag>...`, at most 3 per push (GitHub
  starts no tag-push workflows above 3). `just release <pkg>` wraps this flow.
- CI stages each version. It stays unpublished until the maintainer approves it with 2FA on npmjs.com (Staged Packages)
  or `npm stage approve <stage-id>`. Prereleases use their identifier (`beta`) as the dist-tag.
- One-time maintainer setup per package:
  `npm trust github @prb/effect-<pkg> --repo PaulRBerg/prb-effect --file release.yml --allow-stage-publish -y`.

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

- Name directories and files in `kebab-case` (e.g., `react-hooks/`, `primitives.ts`); React component files use
  `PascalCase`.
- Use `function` declarations for named functions, `readonly` for immutable properties, and `satisfies` for type-safe
  constants.

### Effect Patterns

- Compose with `Effect.gen`.
- Model services as `Context.Service` classes with `Layer` implementations.
- Define expected errors as `Schema.TaggedError` classes and raise them with `Effect.fail`; use `Effect.die` for bugs.
- Wrap Promises that can reject with `Effect.tryPromise` and map the cause to a tagged error. Reserve `Effect.promise`
  for Promises that cannot reject and `Effect.sync` for synchronous side effects.

## Module Structure

- Give each module an `index.ts` barrel. The `./*` package export publishes every `src/<module>/index.ts` as a subpath,
  so a new barrel is new public API.
- Import other modules through their barrels (`#src/<module>/index.js`); keep deep imports to barrels and internal
  wiring.
- Keep unexported helpers in `internal/` directories.

## Testing

- Co-locate tests with source: `*.test.ts` for unit tests, `*.test.integration.ts` for network-dependent tests.
- Use `@effect/vitest` for Effect tests, and cover both success and failure cases.
