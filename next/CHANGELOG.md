# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/next%401.0.0
[1.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/next%401.0.1
[1.1.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/next%401.1.0

## [1.1.0] - 2026-02-13

### Changed

- Inline `@mcrovero/effect-react-cache` into a built-in `reactCache` implementation
- Remove `@mcrovero/effect-react-cache` peer dependency

## [1.0.1] - 2026-02-09

### Changed

- Add `default` export condition to `package.json` for CJS compatibility (tsx, Playwright)

## [1.0.0] - 2026-02-03

### Added

- Add Route handlers: `Next.make` for Effect-based Next.js route handlers
- Add Server actions: `runServerAction`, `runServerActionOrThrow`
- Add Middleware composition with Effect layers
- Add Request-scoped caching via `reactCache` integration with React cache()
- Add Headers and cookies as Effect services
- Add Route and search params as Effect services
- Add Navigation utilities: `redirect`, `rewrite`, `notFound`
- Add React hooks: `useEffectMemo`, `useEffectOnce`, `useForkEffect`, `useStream`, `useStreamLatest`
- Add Environment helpers with injectable resolver
- Add Telemetry adapters for Sentry and OTLP
- Add Testing kit with assertion helpers and mock runtime
