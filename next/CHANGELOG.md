# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/next%401.0.0
[1.0.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/next%401.0.1
[1.1.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/next%401.1.0
[1.1.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/next%401.1.1
[1.2.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/next%401.2.0
[1.2.1]: https://github.com/PaulRBerg/prb-effect/releases/tag/next@1.2.1
[2.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/next@2.0.0

## [2.0.0] - 2026-10-04

### Changed

- Require Effect `^4.0.0`; remove the `@effect/platform` and `@effect/opentelemetry` peers in favor of `effect/http` and
  `effect/observability`.
- Back middleware `Tag` factories and service exports with native `Context.Service` keys; retain middleware metadata,
  wrapping, and failure inference.
- Return `Effect<Context.Context<R>, E>` from `createStatefulContext`; use `ManagedRuntime.contextEffect` and provide
  extracted contexts with `Effect.provide` or retrieve services with `Context.get`.
- Use native schema constraints and codecs, preserving separate decoding and encoding service requirements; parameter
  decoders require decoding services and persistent caches require both directions plus storage services.
- Capture the first caller's context in Effect-returning `reactCache` and execute cached exits with
  `Effect.runPromiseExitWith`; retain request coalescing, tracing, memoized failures, and compile-time Scope rejection.
- Use `Duration.Input`, native `Result`, flattened Cause reasons, `Deferred.into`, and detached refresh fibers while
  retaining cache TTL, stale refreshes, codec round trips, failure policies, and cancellation cleanup.
- Expose native `OtlpExporter.Flusher` from configured OTLP layers; disabled and unconfigured layers remain empty.
  Custom-client layers retain `HttpClient` requirements, including conservatively typed dynamic options.
- Preserve Next.js typed navigation and native control-flow defects at execution boundaries, first typed failure
  selection for actions/hooks/testing helpers, and suppressed unhandled logs in managed handlers.

## [1.2.1] - 2026-10-03

### Fixed

- Release keyed React cache argument handoffs after each invocation so cached functions do not retain request data
  ([`f30bb58`](https://github.com/PaulRBerg/prb-effect/commit/f30bb58))
- Encode transformed-schema values before persisting them and validate decoded values during refresh so cache round
  trips preserve their types ([`f86d27d`](https://github.com/PaulRBerg/prb-effect/commit/f86d27d))
- Cancel superseded React hook work, handle Strict Mode effect replay, and prevent stale executions from replacing
  current state ([`8d077c2`](https://github.com/PaulRBerg/prb-effect/commit/8d077c2))
- Surface falsy stream errors and honor `maxItems: 0`
  ([`8d077c2`](https://github.com/PaulRBerg/prb-effect/commit/8d077c2))
- Align route, header, cookie, parameter, and navigation examples with the exported APIs
  ([`0e84b8f`](https://github.com/PaulRBerg/prb-effect/commit/0e84b8f))

## [1.2.0] - 2026-06-19

### Added

- Add persistent cache-aside helpers with TTL, stale-while-revalidate, schema decoding, and pluggable storage
  ([`fd6d61d`](https://github.com/PaulRBerg/prb-effect/commit/fd6d61d29d2852dccddcf99fe5bfe7efe73fdcf9))
- Add cache-control builders for browser, CDN, and Vercel response headers
  ([`fd6d61d`](https://github.com/PaulRBerg/prb-effect/commit/fd6d61d29d2852dccddcf99fe5bfe7efe73fdcf9))
- Add fixed-window rate-limit middleware with pluggable storage and route-handler key helpers
  ([`fd6d61d`](https://github.com/PaulRBerg/prb-effect/commit/fd6d61d29d2852dccddcf99fe5bfe7efe73fdcf9))
- Add request timing sampling, filtering, and prop-redaction controls
  ([`fd6d61d`](https://github.com/PaulRBerg/prb-effect/commit/fd6d61d29d2852dccddcf99fe5bfe7efe73fdcf9))

## [1.1.1] - 2026-06-09

### Changed

- Bump Effect telemetry peer dependency baseline to `@effect/opentelemetry@^0.63.0` and preserve OTLP JSON serialization
  ([`671511d`](https://github.com/PaulRBerg/prb-effect/commit/671511d))

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
