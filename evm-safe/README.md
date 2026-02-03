# effect-evm-safe

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Effect](https://img.shields.io/badge/Effect-v3-7C3AED)](https://effect.website)

> [!WARNING]
>
> This is experimental, beta software. It is provided "as is" without warranty of any kind, express or implied.

Safe Apps + Safe multisig utilities for Effect, built on top of `@prb/effect-evm`.

## Installation

```bash
bun add @prb/effect-evm-safe @prb/effect-evm @safe-global/safe-apps-sdk
```

Peer dependencies

- `effect@^3`
- `@effect/platform@^0.93`
- `@prb/effect-evm@^1.0.0`
- `@safe-global/safe-apps-sdk@9.1.0`
- `viem@^2.43`
- Optional: `@wagmi/core@>=2.0.0` (for hooks using wagmi)
- Optional: `react@>=18.2.0`, `react-dom@>=18.2.0` (for React hooks)

## Usage

```typescript
import { Layer } from "effect";
import { makeEffectEvmLayer } from "@prb/effect-evm";
import { SafeAppsServiceLive } from "@prb/effect-evm-safe";

const baseLayer = makeEffectEvmLayer(/* chain configs */, window.ethereum);
const layer = Layer.provideMerge(SafeAppsServiceLive(), baseLayer);
```

## Exports

- Safe Apps service: `SafeAppsService`, `SafeAppsServiceLive`
- Safe detection: `isSafeMultisig`
- Safe simulation: `SafeMultisigSimulationService`, `SafeMultisigSimulationServiceLive`
- Types + errors: `safe/*`
- React hooks: `@prb/effect-evm-safe/react-hooks`

## License

MIT
