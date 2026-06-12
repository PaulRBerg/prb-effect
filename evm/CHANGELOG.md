# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%401.0.0
[1.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%401.0.1
[1.1.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%401.1.0
[1.1.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%401.1.1
[1.2.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%401.2.0
[1.2.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%401.2.1
[1.3.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%401.3.0
[1.3.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%401.3.1
[1.4.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%401.4.0
[2.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%402.0.0
[2.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%402.0.1
[2.1.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%402.1.0
[2.1.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%402.1.1
[2.2.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%402.2.0
[2.1.2]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%402.1.2
[2.2.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%402.2.1
[2.2.2]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm%402.2.2

## [2.2.2] - 2026-06-12

### Changed

- Resolve the write-execution adapter from call-time context so it can be provided anywhere in the final layer
  composition, with no ordering requirement relative to `ContractPipelineLive`
  ([`a661cd8`](https://github.com/PaulRBerg/prb-effect/commit/a661cd8))

### Fixed

- Scope nonce reservation to each write so a user rejection frees the nonce immediately, and re-confirm the nonce on
  revert ([`a661cd8`](https://github.com/PaulRBerg/prb-effect/commit/a661cd8))
- Surface event-stream and backfill RPC failures as typed `EventWatchError`s instead of silent defects or stuck fibers
  ([`a661cd8`](https://github.com/PaulRBerg/prb-effect/commit/a661cd8))
- Fix cursor resume and sync gaps, and the local-storage cursor-store delete/flush race
  ([`a661cd8`](https://github.com/PaulRBerg/prb-effect/commit/a661cd8))
- Re-arm the RPC circuit breaker after the reset window, stop counting reverts toward the failure threshold, and drop
  unhandled deduplication rejections ([`a661cd8`](https://github.com/PaulRBerg/prb-effect/commit/a661cd8))
- Retry `track()` receipt fetches, and report `confirmations: 0` while a tracked transaction is still pending
  ([`a661cd8`](https://github.com/PaulRBerg/prb-effect/commit/a661cd8))
- Fix `toWei` scaling, basis-point rounding, and `formatGas` precision
  ([`a661cd8`](https://github.com/PaulRBerg/prb-effect/commit/a661cd8))
- Re-prompt the zero-first ERC-20 allowance flow after a user rejection
  ([`a661cd8`](https://github.com/PaulRBerg/prb-effect/commit/a661cd8))

## [2.2.1] - 2026-06-09

### Changed

- Bump Effect peer dependency baseline to `effect@^3.21.3` and `@effect/platform@^0.96.1`
  ([`671511d`](https://github.com/PaulRBerg/prb-effect/commit/671511d))

## [2.2.0] - 2026-04-03

### Added

- Add OP Stack L1 data fee estimation to `GasService` with `estimateL1Fee` and `hasL1DataFee` methods
  ([`6802b92`](https://github.com/PaulRBerg/prb-effect/commit/6802b92))
- Add `isOpStackClient` utility to detect OP Stack chains via `gasPriceOracle` contract presence
  ([`6802b92`](https://github.com/PaulRBerg/prb-effect/commit/6802b92))

## [2.1.2] - 2026-04-02

### Fixed

- Preserve transaction `msg.value` in tagged contract execution errors as a decimal string for downstream UIs and
  simulators ([`74e67bc`](https://github.com/PaulRBerg/prb-effect/commit/74e67bc))

## [2.1.1] - 2026-03-21

### Fixed

- Infer `insufficient-funds` from RPC gas-estimation errors that combine "gas required exceeds allowance" with "missing
  or invalid parameters" ([`a483033`](https://github.com/PaulRBerg/prb-effect/commit/a483033))

## [2.1.0] - 2026-02-25

### Added

- Detect Safe SDK "Transaction was rejected" message in `isLikelyUserRejectedError`
  ([`7216954`](https://github.com/PaulRBerg/prb-effect/commit/7216954))

## [2.0.1] - 2026-02-21

### Fixed

- Guard `error.details` access in `isResourceExhaustion` to prevent `TypeError` when `CoreError.details` is undefined
  ([`8dc9642`](https://github.com/PaulRBerg/prb-effect/commit/8dc9642))

## [2.0.0] - 2026-02-20

### Changed

- Make `ContractPipeline.writeAndWait` adapter-aware by routing through `writeAndTrack` execution paths
- Replace `WriteAndTrackExecution.result` with `WriteAndTrackExecution.terminal`
- Change `ContractPipeline.writeAndWait` return type to terminal union (`success` | `queued` | `cancelled`)
- Extend `TxState` with `queued` and `cancelled` variants and persist them in browser tx storage
- Rename `useWriteAndTrack` output from `result` to `terminal`

### Removed

- Remove legacy `write-and-wait` / `runCorePipeline` path in favor of unified adapter-routed execution

## [1.4.0] - 2026-02-18

### Changed

- Route `ContractPipeline.writeAndTrack` through optional `WriteExecutionAdapter` implementations before falling back to
  the default EOA flow
- Expose `WriteAndTrackExecution` and `WriteAndTrackActions` types for adapter implementations

### Added

- Add `WriteExecutionAdapter` service tag for pluggable wallet execution strategies
- Add `TxStore.changes` and `TxStore.watchInFlight()` streams with `TxStoreChange` events
- Add `useTxStoreChanges` and `useInFlightTxs` React hooks for realtime tx-store subscriptions
- Add `toUserFacingTxError` to normalize transaction failures into stable UI categories

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
