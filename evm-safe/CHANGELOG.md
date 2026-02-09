# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm-safe%401.0.0
[1.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm-safe%401.0.1

## [1.0.1] - 2026-02-09

### Changed

- Add `default` export condition to `package.json` for CJS compatibility (tsx, Playwright)

## [1.0.0] - 2026-02-03

### Added

- Add Safe Apps service: `SafeAppsService`, `SafeAppsServiceLive` for Safe Wallet integration
- Add Safe multisig detection: `isSafeMultisig` utility
- Add Safe transaction simulation: `SafeMultisigSimulationService`, `SafeMultisigSimulationServiceLive`
- Add React hooks via `@prb/effect-evm-safe/react-hooks`
