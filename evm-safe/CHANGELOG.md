# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%401.0.0
[1.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%401.0.1
[1.1.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%401.1.0
[1.1.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%401.1.1
[2.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%402.0.0
[2.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%402.0.1
[2.0.2]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%402.0.2
[2.1.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%402.1.0
[3.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%403.0.0
[3.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/evm-safe%403.0.1

## [3.0.1] - 2026-02-25

### Fixed

- Propagate user rejection as `UserRejectedError` in `sendTxs` and `signTypedData` instead of collapsing to generic
  `SafeMultisigTxSubmissionError` / `SignTypedDataError`
  ([`5655f12`](https://github.com/PaulRBerg/prb-effect/commit/5655f12))

## [3.0.0] - 2026-02-20

### Changed

- Map Safe `queued` and `cancelled` outcomes to pipeline terminal unions instead of coercing to `TxFailedError`
- Emit `TxState` `queued` / `cancelled` statuses from `SafeWriteExecutionAdapterLive`
- Align adapter execution API with `WriteAndTrackExecution.terminal` in `@prb/effect-evm@^2`

## [2.1.0] - 2026-02-18

### Changed

- Add optional `multiSendStrategy: "fallback-required-approval"` to `safeMultisigAllowAndWrite` for chains without
  MultiSend
- Normalize Safe lookup failures via shared `toSafeMultisigTxLookupError` constructor

### Added

- Add `safeWriteAndTrack` with lifecycle callbacks and streamed Safe state transitions
- Add `SafeWriteExecutionAdapterLive` to bridge Safe execution into `@prb/effect-evm` `ContractPipeline`
- Add `useWalletExecution` hook for Safe-versus-EOA routing across context, connector, origin, and owners probe
- Add `cancelled` status support to `SafeMultisigTxStatus`
- Export `SafeMultisigAllowAndWriteResult` and Safe write-and-track types from `safe` module

## [2.0.2] - 2026-02-18

### Fixed

- Allow `setSafeAppOrigins` and `extendSafeAppOrigins` to be called multiple times by removing the one-time
  configuration guard

## [2.0.1] - 2026-02-18

### Changed

- Enrich `waitForSafeMultisigTx` timeout `queued` result with confirmation progress: `confirmations`,
  `confirmationsRequired`, and normalized `lastStatus`
- Preserve last known Safe API status during polling so timeout responses include actionable state
- Reuse shared status mapping between `waitForSafeMultisigTx` and `getSafeMultisigTxStatus`

## [2.0.0] - 2026-02-17

### Changed

- Rename `txHash` to `onchainHash` in `SafeAppsService.getTx` return type
- Rename `hash` to `onchainHash` in `SafeMultisigWaitResult` success variant
- Include `safeTxHash` in all `SafeMultisigWaitResult` variants
- Return `SafeMultisigTxInfo` type from `getTx` with confirmation metadata

### Added

- Add `SafeMultisigTxInfo` type with `confirmations` and `confirmationsRequired` fields
- Add `getSafeMultisigTxUrl` utility to build Safe web UI transaction URLs

## [1.1.1] - 2026-02-10

### Changed

- Preserve Safe SDK submission cause details (including nested `cause` and user-rejection `4001`) so
  `SafeMultisigTxSubmissionError` and batch write failures no longer collapse to generic messages

## [1.1.0] - 2026-02-10

### Added

- Add `safeMultisigBatchWrite` for atomic multi-transaction Safe batches via MultiSend
- Add `safeMultisigAllowAndWrite` for ERC-20 approve + action as a single Safe proposal
- Add `buildSafeApproveTx` helper to encode ERC-20 approve calls as Safe transactions
- Add `waitForSafeMultisigTx` to poll Safe transaction lifecycle until terminal state or timeout
- Add `getSafeMultisigTxStatus` for one-shot Safe transaction status checks
- Add `SafeMultiSendUnavailableError` for chains without MultiSend contract
- Add `isMultiSendUnavailableError` detector with depth-limited cause chain traversal

## [1.0.1] - 2026-02-09

### Changed

- Add `default` export condition to `package.json` for CJS compatibility (tsx, Playwright)

## [1.0.0] - 2026-02-03

### Added

- Add Safe Apps service: `SafeAppsService`, `SafeAppsServiceLive` for Safe Wallet integration
- Add Safe multisig detection: `isSafeMultisig` utility
- Add Safe transaction simulation: `SafeMultisigSimulationService`, `SafeMultisigSimulationServiceLive`
- Add React hooks via `@prb/effect-evm-safe/react-hooks`
