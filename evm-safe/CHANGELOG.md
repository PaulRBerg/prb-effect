# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm-safe%401.0.0
[1.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm-safe%401.0.1
[1.1.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm-safe%401.1.0
[1.1.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm-safe%401.1.1

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
