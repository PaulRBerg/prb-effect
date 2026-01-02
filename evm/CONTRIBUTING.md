## Contributing

### Prerequisites

- [Node.js](https://nodejs.org) (v20+)
- [Bun](https://bun.sh) (package manager + runtime)
- [Just](https://github.com/casey/just) (command runner)
- [Ni](https://github.com/antfu-collective/ni) (optional; provides `na`, `ni`, `nr`, etc.)

### Setup

```bash
git clone <your-fork-url> prb-effect
cd prb-effect/web3
bun install
```

### Available commands

```bash
just --list       # show all commands
just build        # build (tsc -> dist/)
just test         # run vitest
just full-check   # run all checks (lint/format/types/etc.)
just full-write   # auto-fix formatting/linting where possible
just type-check   # type-check (tsgo/tsc)
```

### Development workflow

1. Fork the repository
2. Create a feature branch
3. Make your changes (add tests when behavior changes)
4. Run `just full-check`
5. Open a pull request

### Project conventions

- Keep the public API intentional: avoid “accidental exports”; prefer exporting from `src/index.ts`.
- Stick to Effect service patterns: `Context.Tag` for services, `Layer.*` for implementations.
- Use typed errors (`Schema.TaggedError`) and `Effect.catchTag` in examples.
- Prefer strict types; avoid `any` (use `unknown` when needed).
