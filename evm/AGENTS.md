# @prb/effect-evm

## References

- **Project overview**: @README.md
- **Dependencies**: @package.json

## Prerequisites

- [Node.js](https://nodejs.org) v20+
- [Bun](https://bun.sh) package manager and runtime
- [Just](https://github.com/casey/just) command runner
- [Ni](https://github.com/antfu-collective/ni) optional package manager resolver (`na`, `ni`, `nr`, etc.)

## Setup

```bash
git clone <your-fork-url> prb-effect
cd prb-effect
bun install
cd evm
```

## Commands

```bash
just --list       # Show all package commands
just build        # Build the package (clean, compile, pack)
just test         # Run all tests
just test-ui      # Run tests in UI mode
just full-check   # Run all checks (lint, format, types, etc.)
just full-write   # Auto-fix formatting and linting where possible
just type-check   # Type-check the package
```

## Aliases

`just b` (build), `just t` (test), `just tui` (test-ui)

## Development Workflow

1. Fork the repository
2. Create a feature branch
3. Make changes and add tests when behavior changes
4. Run `just full-check`
5. Open a pull request

## Project Conventions

- Keep the public API intentional: avoid accidental exports; prefer exporting from `src/index.ts`.
- Stick to Effect service patterns: `Context.Tag` for services, `Layer.*` for implementations.
- Use typed errors (`Schema.TaggedError`) and `Effect.catchTag` in examples.
- Prefer strict types; avoid `any` and use `unknown` when needed.
