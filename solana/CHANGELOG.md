# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/solana@1.0.0

## [1.0.0] - 2026-10-04

### Changed

- Target the stable 1.0.0 release on Effect `^4.0.0`; remove the `@effect/platform` peer.
- Use native `Context.Service` service keys and `Context.Key` mock-layer inputs while retaining exported service names.
- Preserve bigint error fields as decimal-string codecs with `Schema.BigIntFromString`.
- Replace testing helpers `assertLeft` / `assertRight` with `assertFailure` / `assertSuccess` for native `Result`
  values.
- Expose `EffectSolanaRuntime.context` as `Context.Context<unknown>` in place of `.runtime`, with native
  `Effect.RunOptions`, `Fiber.Fiber`, `Scope.Closeable`, and context-based runners.
- Build layer contexts with `Layer.build` / `Scope.provide`, attach hook fibers to their scopes before execution, and
  retain synchronous acquisition, closed-scope cancellation, and delayed-finalizer cleanup behavior.
- Use native flattened Cause reasons and `Cause.findErrorOption`, preserving typed failures and defect identity.
- Memoize RPC subscription connections with `Cache` per WebSocket URL, retaining identity without expiry or eviction.
- Capture complete contexts for external Anchor signer callbacks, preserving inherited services/tracing and current
  signer resolution.
- Use native polling streams, `SubscriptionRef.changes(ref)`, timeout tags, and effectful schedule delays while
  retaining transaction and balance behavior.
