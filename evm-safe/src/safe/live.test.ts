// @vitest-environment jsdom
import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { afterEach, vi } from "vitest";
import type { SafeAppsSDKInstance, SafeAppsSdkConfig } from "./adapter.js";
import { SafeAppsSdkUnavailableError } from "./errors.js";

// --- Mock @prb/effect-evm/core/errors (its viem-mapper uses unresolvable #src specifiers) ---

vi.mock("@prb/effect-evm/core/errors", () => {
  class MockUserRejectedError extends Error {
    readonly _tag = "UserRejectedError";

    constructor(args: { readonly message: string }) {
      super(args.message);
      this.name = "UserRejectedError";
    }
  }

  return {
    isUserRejectedError: () => false,
    UserRejectedError: MockUserRejectedError,
  };
});

// --- Mock TxManager (the real @prb/effect-evm/tx barrel uses unresolvable #src specifiers) ---

vi.mock("@prb/effect-evm/tx", async () => {
  const { Context } = await import("effect");

  class MockTxManager extends Context.Tag("ew3/TxManager")<
    MockTxManager,
    { readonly waitForReceipt: (...args: readonly unknown[]) => Effect.Effect<unknown> }
  >() {}

  return { TxManager: MockTxManager };
});

// --- Mock the SDK loader so we control load success/failure and the SDK's getInfo behavior ---

const loadOverride = vi.hoisted(() => ({
  impl: null as null | ((config?: SafeAppsSdkConfig) => Effect.Effect<unknown, unknown>),
}));

vi.mock("./adapter.js", async () => {
  const { Effect: E } = await import("effect");
  return {
    loadSafeSdk: (config?: SafeAppsSdkConfig) =>
      loadOverride.impl ? loadOverride.impl(config) : E.dieMessage("loadSafeSdk not configured"),
  };
});

const { SafeAppsServiceLive } = await import("./live.js");
const { TxManager } = await import("@prb/effect-evm/tx");
const { SafeAppsService } = await import("./service.js");

const TEST_SAFE_ADDRESS = "0x0000000000000000000000000000000000000001";
const TEST_CHAIN_ID = 1;

const txManagerLayer = Layer.succeed(
  TxManager,
  TxManager.of({ waitForReceipt: () => Effect.dieMessage("unused") } as unknown as Parameters<
    typeof TxManager.of
  >[0])
);

/** Build a minimal SDK whose `safe.getInfo` resolves with the given delay (never if `delay` omitted). */
function makeFakeSdk(getInfo: () => Promise<{ chainId: number; safeAddress: string }>) {
  return {
    safe: { getInfo },
  } as unknown as SafeAppsSDKInstance;
}

/** Pretend the page is embedded in a Safe host so the iframe guard passes. */
function asEmbedded(): void {
  Object.defineProperty(window, "parent", {
    configurable: true,
    value: {} as Window,
    writable: true,
  });
}

/** Restore top-level window semantics (parent === self). */
function asTopLevel(): void {
  Object.defineProperty(window, "parent", { configurable: true, value: window, writable: true });
}

afterEach(() => {
  loadOverride.impl = null;
  asTopLevel();
});

describe("SafeAppsServiceLive getSdk", () => {
  it.effect("retries SDK load after a transient failure (does not cache the failure)", () =>
    Effect.gen(function* () {
      asEmbedded();
      let loadAttempts = 0;
      loadOverride.impl = () =>
        Effect.suspend(() => {
          loadAttempts += 1;
          if (loadAttempts === 1) {
            return Effect.fail(
              new SafeAppsSdkUnavailableError({ message: "transient chunk load failure" })
            );
          }
          return Effect.succeed(
            makeFakeSdk(async () => ({ chainId: TEST_CHAIN_ID, safeAddress: TEST_SAFE_ADDRESS }))
          );
        });

      const service = yield* SafeAppsService;

      // First call fails to load the SDK.
      const first = yield* service.getInfo().pipe(Effect.either);
      expect(first._tag).toBe("Left");

      // Second call succeeds — proving the failure was not cached.
      const second = yield* service.getInfo();
      expect(second).toEqual({ chainId: TEST_CHAIN_ID, safeAddress: TEST_SAFE_ADDRESS });
      expect(loadAttempts).toBe(2);
    }).pipe(Effect.provide(Layer.provide(SafeAppsServiceLive(), txManagerLayer)), Effect.scoped)
  );

  it.effect("fails fast with NotInSafeAppContextError in a top-level window", () =>
    Effect.gen(function* () {
      asTopLevel();
      loadOverride.impl = () => Effect.dieMessage("loadSafeSdk must not be called for top-level");

      const service = yield* SafeAppsService;
      const exit = yield* service.getInfo().pipe(Effect.either);

      expect(exit._tag).toBe("Left");
      if (exit._tag === "Left") {
        // getInfo maps the underlying NotInSafeAppContextError into SafeMultisigInfoUnavailableError.
        expect(exit.left._tag).toBe("SafeMultisigInfoUnavailableError");
        expect(exit.left.message).toContain("embedded in a Safe App host");
      }
    }).pipe(Effect.provide(Layer.provide(SafeAppsServiceLive(), txManagerLayer)), Effect.scoped)
  );

  // `it.live` so the real clock drives the short configured timeout against a never-settling promise
  // (TestClock would not advance virtual time on its own here).
  it.live("getInfo times out when an embedded parent never responds", () =>
    Effect.gen(function* () {
      asEmbedded();
      // SDK loads fine, but its getInfo never settles (mimics a non-Safe parent dropping the msg).
      const neverResolves = () =>
        new Promise<never>(() => {
          /* intentionally never settles */
        });
      loadOverride.impl = () => Effect.succeed(makeFakeSdk(neverResolves));

      const service = yield* SafeAppsService;
      const exit = yield* service.getInfo().pipe(Effect.either);

      expect(exit._tag).toBe("Left");
      if (exit._tag === "Left") {
        expect(exit.left._tag).toBe("SafeMultisigInfoUnavailableError");
        expect(exit.left.message).toContain("timed out");
      }
    }).pipe(
      Effect.provide(
        Layer.provide(SafeAppsServiceLive({ getInfoTimeout: "20 millis" }), txManagerLayer)
      ),
      Effect.scoped
    )
  );
});
