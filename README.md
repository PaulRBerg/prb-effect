# prb-effect

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Effect](https://img.shields.io/badge/Effect-v3-7C3AED)](https://effect.website)
[![Biome](https://img.shields.io/badge/Linted_with-Biome-60a5fa?style=flat&logo=biome)](https://biomejs.dev)

A Bun-powered monorepo for Effect-TS libraries.

## Packages

| Package                          | Description                                        |
| -------------------------------- | -------------------------------------------------- |
| [`@prb/effect-fmt`](./fmt)       | Formatting utilities for numbers, dates, durations |
| [`@prb/effect-next`](./next)     | Effect integration for Next.js                     |
| [`@prb/effect-web3`](./web3)     | Effect integration for Web3/viem                   |
| [`@prb/effect-xstate`](./xstate) | xState v5 workflow utilities                       |

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
just fmt::build
just next::build
just web3::build
just xstate::build
```

## Project Structure

```
prb-effect/
├── fmt/                 # @prb/effect-fmt - formatting utilities
├── next/                # @prb/effect-next - Next.js integration
├── web3/                # @prb/effect-web3 - Web3/viem integration
├── xstate/              # @prb/effect-xstate - xState v5 workflows
├── package.json         # Root workspace with catalogs
└── justfile             # Task automation
```

## License

MIT
