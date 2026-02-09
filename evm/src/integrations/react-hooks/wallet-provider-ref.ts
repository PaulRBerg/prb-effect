"use client";

import * as Effect from "effect/Effect";
import { constVoid as noop } from "effect/Function";
import * as React from "react";
import type { WalletProvider } from "#src/wallet/index.js";
import { WalletProviderRef } from "#src/wallet/index.js";
import { useEffectEvmRuntime } from "./provider.js";

export type WalletProviderRefActions = {
  readonly clearProvider: () => void;
  readonly setProvider: (provider: WalletProvider) => void;
};

export const useWalletProviderRef = (): WalletProviderRefActions => {
  const runtime = useEffectEvmRuntime();

  const setProvider = React.useCallback(
    (provider: WalletProvider) => {
      runtime
        .runPromise(
          Effect.gen(function* () {
            const ref = yield* WalletProviderRef;
            yield* ref.set(provider);
          })
        )
        .catch(noop);
    },
    [runtime]
  );

  const clearProvider = React.useCallback(() => {
    runtime
      .runPromise(
        Effect.gen(function* () {
          const ref = yield* WalletProviderRef;
          yield* ref.clear;
        })
      )
      .catch(noop);
  }, [runtime]);

  return { clearProvider, setProvider };
};
