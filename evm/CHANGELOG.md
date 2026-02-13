# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm%401.0.0
[1.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm%401.0.1
[1.1.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm%401.1.0
[1.1.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm%401.1.1
[1.2.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm%401.2.0
[1.2.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm%401.2.1
[1.3.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm%401.3.0
[1.3.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm%401.3.1

## [1.3.1] - 2026-02-13

### Fixed

- Fail fast on reverted transactions in `ContractPipeline`, `writeAndTrack`, and `TxManager` instead of silently
  succeeding with a reverted receipt

## [1.3.0] - 2026-02-13

### Changed

- Enrich `SimulationFailedError` and `GasEstimationError` with `phase`, `revertReason`, and `customErrorName` fields
- Refactor `writeAndTrack` to track failure phases (`preflight`, `submission`, `receipt`, `event-decode`) and propagate
  `preflightWarning` through all `TxState` variants

### Added

- Add configurable preflight modes (`strict`, `best-effort`, `none`) for `ContractPipeline` write operations via
  `preflight.mode` parameter
- Add `TxFailedPhase` and `TxPreflightWarning` types to `TxState` for granular failure tracking
- Add `decodeExecutionFailure` utility for structured revert reason extraction from viem errors

### Fixed

- Relax best-effort preflight recovery to continue on any `GasEstimationError` or `SimulationFailedError`, not just
  execution reverts

## [1.2.1] - 2026-02-11

### Fixed

- Propagate `ResourceExhaustionError` through EIP-7702 and ERC-20 allowance flows instead of collapsing memory-pressure
  failures into generic errors
- Preserve explicit resource-exhaustion classification in mapper tests

## [1.2.0] - 2026-02-10

### Added

- Add `isMetaMaskExtensionConnectionError` detector for broken MetaMask extension bridge errors
- Add `getWalletExtensionErrorDetail` to extract typed `WalletExtensionErrorDetail` from unknown errors
- Add `isWalletExtensionErrorDetail` type guard

## [1.1.1] - 2026-02-09

### Changed

- Add `default` export condition to `package.json` for CJS compatibility (tsx, Playwright)

## [1.1.0] - 2026-02-09

### Changed

- Add `calldata` and `sender` fields to `ContractWriter` error context (`classifyContractError`, `classifyWriteError`,
  `classifyGasEstimationError`)
- Fetch blocks concurrently in `BlockService.getBlocks` with `Effect.forEach` (concurrency: 10)

### Fixed

- Fix state mutation in `NonceManager` by using immutable `Ref` updates
- Fix `BalanceService.watchTokenBalance` to use `client.readContract` directly instead of running an Effect inside a
  callback
- Deduplicate transaction fetching in `TxTracker` via shared `getOriginalTx` helper

## [1.0.1] - 2026-02-04

### Added

- Add optional `txPolicy` parameter to `WagmiWalletClientOptions` for customizing receipt timeout and tx settings per
  layer
- Add `makeEffectEvmServices()` factory function for flexible service composition

## [1.0.0] - 2026-02-03

### Added

- Add Contract services: `ContractReader` (multicall), `ContractWriter`, `ContractPipeline`, `typedContract`
- Add Transaction management with `TxManager` and reactive state tracking
- Add Event streams: `EventStream`, `ReliableEventStream` with confirmation filtering and reorg handling
- Add Chain utilities: `BalanceService`, `BlockService`, `GasService`, `NonceService`
- Add Deploy and NFT services: `DeployService`, `Erc721Service`
- Add Signature and simulation: `SignatureService`, `SimulationService` (Tenderly)
- Add Subscriptions: `SubscriptionService` for blocks, logs, and pending transactions
- Add EIP-7702 delegation and atomic batching for EOAs
- Add React hooks via `@prb/effect-evm/react-hooks`
- Add Safe detection hooks: `useIsSafeAppContext`, `useIsHostSafeApp`, `useIsSafeMultisigWallet`
- Add Wagmi integration via `@prb/effect-evm/wagmi`
- Add Browser persistence utilities in `browser` namespace
- Add Testing kit via `@prb/effect-evm/testing-kit`
