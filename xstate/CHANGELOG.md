# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/xstate%401.0.0
[1.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/xstate%401.0.1
[2.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/xstate%402.0.0
[2.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/xstate%402.0.1
[2.0.2]: https://github.com/PaulRBerg/prb-effect/releases/tag/xstate%402.0.2
[3.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/xstate%403.0.0
[3.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/xstate%403.0.1

## [3.0.1] - 2026-04-02

### Fixed

- Preserve tagged transaction `value` when extracting structured transaction errors for downstream UIs and simulators
  ([`74e67bc`](https://github.com/PaulRBerg/prb-effect/commit/74e67bc))

## [3.0.0] - 2026-03-02

### Changed

- Restrict `createFacilitatorMachine` `CREATE` transitions to `checked` states where eligibility status is `"true"`
- Remove `CREATE` transition from facilitator `failed` state; retries now require `CHECK` or `RESET`
- Make `createFormMachine` context `payload` and `preprocess` fields nullable (`null` at rest/reset)
- Clear stale form `error`, `result`, and `preprocess` on each retry `SAVE`, and clear `error` on successful process
- Make `useFormWorkflow().preprocess` nullable to match machine context
- Add strict runtime schema validation for `createTxMachine` gas/simulation outputs and hash-bearing sign/confirm
  outputs

## [2.0.2] - 2026-02-17

### Fixed

- Allow `gasLimit` to be `undefined` in gas check result

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
