# @prb/effect-evm

[![MIT License](https://img.shields.io/badge/license-MIT-blue.svg)](../LICENSE)
[![Effect](https://img.shields.io/badge/Effect-v4-7C3AED)](https://effect.website)
[![viem](https://img.shields.io/badge/viem-v2-1E1E1E)](https://viem.sh)

> [!WARNING]
>
> This is experimental, beta software. It is provided "as is" without warranty of any kind, express or implied.

Type-safe, composable EVM abstractions for [Effect](https://effect.website), built on [viem](https://viem.sh).

![Banner](./banner.png)

## 📦 Installation

```bash
bun add @prb/effect-evm
```

**Peer dependencies**

- `effect@^4.0.0`
- `viem@^2.43`
- Optional: `@wagmi/core@>=2.0.0` (for `@prb/effect-evm/wagmi`)
- Optional: `react@>=18.2.0`, `react-dom@>=18.2.0` (for `@prb/effect-evm/react-hooks`)

## Migration to v5

Version 5 requires native Effect 4. Update custom service/layer implementations and any Effect runtime integration
alongside the package upgrade:

- `useEffectEvmRuntime()` exposes `.context` instead of `.runtime`; its bound runner methods remain available.
- Testing-kit `assertLeft` / `assertRight` become `assertFailure` / `assertSuccess` and accept `Result.Result` values.
- HTTP services use `effect/http`; `@effect/platform` is no longer a peer dependency.

See [the Effect 4 migration reference](./DOCS.md#migration-to-v5-effect-4) for runner, service, schema, and testing
examples.

## 🚀 Usage

```typescript
import { Effect } from "effect";
import { mainnet } from "viem/chains";
import { ContractReader, erc20Abi, makeEffectEvmLayer, type ChainConfig } from "@prb/effect-evm";

// 1. Configure chains
const configs: ChainConfig[] = [{ chainId: 1, chain: mainnet, rpcUrls: ["https://rpc.example"] }];

// 2. Create the layer
const EvmLayer = makeEffectEvmLayer(configs, window.ethereum);

// 3. Use services
const program = Effect.gen(function* () {
  const reader = yield* ContractReader;
  return yield* reader.read({
    chainId: 1,
    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    abi: erc20Abi,
    functionName: "balanceOf",
    args: ["0x..."],
  });
});

// 4. Run
Effect.runPromise(program.pipe(Effect.provide(EvmLayer)));
```

## ✨ Features

- **Contracts** — `ContractReader` (multicall), `ContractWriter`, `ContractPipeline`, `typedContract`
- **Transactions** — `TxManager` with reactive state tracking
- **Events** — `EventStream`, `ReliableEventStream` (confirmations + reorg filtering)
- **Chain utilities** — `BalanceService`, `BlockService`, `GasService`, `NonceService`
- **Deploy + NFTs** — `DeployService`, `Erc721Service`
- **Signatures + simulation** — `SignatureService`, `SimulationService` (Tenderly)
- **Subscriptions** — `SubscriptionService` (blocks/logs/pending tx)
- **EIP-7702** — Delegation and atomic batching for EOAs
- **React hooks** — `@prb/effect-evm/react-hooks` (primitives + providers); convenience hooks in
  `@prb/effect-evm/integrations/react-hooks/convenience`
- **Safe App + Safe multisig** — see [`@prb/effect-evm-safe`](../evm-safe)
- **Wagmi integration** — `@prb/effect-evm/wagmi` (build layers from wagmi config)
- **Browser persistence** — `browser` namespace (localStorage-backed stores)
- **Testing** — `@prb/effect-evm/testing-kit` (mocks + `makeEffectEvmTestLayer`)

## ⚙️ Write Preflight Modes

`ContractPipeline.writeAndTrack` / `writeAndWait` now support per-call preflight strategy:

- `strict` (default): estimate + simulate, fail on either
- `best-effort`: continue on `GasEstimationError` / `SimulationFailedError`
- `none`: skip estimate/simulate and submit directly

`best-effort` only relaxes preflight; submission/receipt/decode errors still fail normally.

Recommended usage:

- Keep `strict` for create, batch, or high-cost writes.
- Consider `best-effort` for simple withdraw/claim flows.
- Use `none` only when your UX intentionally prefers wallet-first submission.

## 🧾 Terminal Outcomes

`ContractPipeline.writeAndWait` and `writeAndTrack(...).terminal` now return a terminal union:

- `{ _tag: "success", hash, receipt, events }`
- `{ _tag: "queued", reference?, reason?, details? }`
- `{ _tag: "cancelled", reference?, reason?, details? }`

Only operational errors (preflight/submission/receipt/decode) use `Effect.fail`.

## 📖 Documentation

- **Usage and examples**: [DOCS.md](./DOCS.md)
- **Development guidance**: [AGENTS.md](./AGENTS.md)

## 📄 License

MIT
