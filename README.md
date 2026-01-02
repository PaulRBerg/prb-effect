# prb-effect

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Effect](https://img.shields.io/badge/Effect-v3-7C3AED)](https://effect.website)
[![Biome](https://img.shields.io/badge/Linted_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

A Bun-powered monorepo for Effect-TS libraries.

## Packages

| Package                          | Description                    |
| -------------------------------- | ------------------------------ |
| [`@prb/effect-next`](./next)     | Effect integration for Next.js |
| [`@prb/effect-evm`](./evm)       | Effect integration for EVM     |
| [`@prb/effect-xstate`](./xstate) | xState v5 workflow utilities   |

## Tech Stack

- **Effect**: Effect-TS v3.x
- **Language**: TypeScript v5.9+
- **Package Manager**: Bun with workspace catalogs
- **Task Runner**: Just (casey/just)
- **Linting & Formatting**: Biome (JS/TS/JSON), Prettier (Markdown/YAML)
- **Testing**: Vitest with @effect/vitest

## Development

**Install dependencies:**

```bash
bun install
```

**Run quality checks:**

```bash
just full-check      # runs prettier, biome, and type check
just tu              # run unit tests
```

**Build packages:**

```bash
just next::build
just evm::build
just xstate::build
```

## Project Structure

```
prb-effect/
├── next/                # @prb/effect-next - Next.js integration
├── evm/                 # @prb/effect-evm - EVM/viem integration
├── xstate/              # @prb/effect-xstate - xState v5 workflows
├── package.json         # Root workspace with catalogs
└── justfile             # Task automation
```

## License

MIT
