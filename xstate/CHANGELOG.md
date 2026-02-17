# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-xstate%401.0.0
[1.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-xstate%401.0.1
[2.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-xstate%402.0.0
[2.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-xstate%402.0.1

## [2.0.1] - 2026-02-17

### Changed

- Prefer confirm-phase `hash` over sign-phase `hash` in `createTxMachine`
- Allow confirm output to clear stale hash with `hash: null`

## [2.0.0] - 2026-02-10

### Changed

- Preserve structured transaction errors in workflow hooks and the transaction machine
- Migrate internal source imports from `@/src/*` to `#src/*` subpath imports

## [1.0.1] - 2026-02-09

### Changed

- Add `default` export condition to `package.json` for CJS compatibility (tsx, Playwright)

## [1.0.0] - 2026-02-03

### Added

- Add Form machine: `createFormMachine` for validation and processing workflows
- Add Facilitator machine: `createFacilitatorMachine` for check-then-create patterns
- Add React hooks: `useFacilitatorWorkflow` for machine state management
- Add Error utilities for extracting and displaying structured error data
