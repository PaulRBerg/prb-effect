import { Context, Effect, Layer, Option, SubscriptionRef } from "effect";
import type { WalletProvider } from "./types.js";

export type WalletProviderRefShape = {
  readonly ref: SubscriptionRef.SubscriptionRef<Option.Option<WalletProvider>>;
  readonly clear: Effect.Effect<void>;
  readonly get: Effect.Effect<Option.Option<WalletProvider>>;
  readonly set: (provider: WalletProvider) => Effect.Effect<void>;
};

export class WalletProviderRef extends Context.Service<WalletProviderRef, WalletProviderRefShape>()(
  "ew3/WalletProviderRef"
) {}

export const makeWalletProviderRefLive = (
  initial?: WalletProvider
): Layer.Layer<WalletProviderRef> =>
  Layer.effect(
    WalletProviderRef,
    Effect.gen(function* () {
      const ref = yield* SubscriptionRef.make(Option.fromNullishOr(initial));

      return WalletProviderRef.of({
        clear: SubscriptionRef.set(ref, Option.none()),
        get: SubscriptionRef.get(ref),
        ref,
        set: (provider) => SubscriptionRef.set(ref, Option.some(provider)),
      });
    })
  );
