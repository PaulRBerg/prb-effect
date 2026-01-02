"use client";

import type { Config } from "@wagmi/core";
import { getAccount, watchAccount } from "@wagmi/core";
import * as Layer from "effect/Layer";
import * as React from "react";
import { makeEffectEvmLayerFromWagmiWithWalletProviderRef } from "@/src/wagmi/index.js";
import type { WalletProvider } from "@/src/wallet/index.js";
import { EffectEvmProvider, EffectEvmProviderSync } from "../provider.js";
import { useWalletProviderRef } from "../wallet-provider-ref.js";

export type WagmiEffectEvmProviderProps = {
  readonly children: React.ReactNode;
  readonly config: Config;
  readonly fallback?: React.ReactNode;
  readonly layer?: Layer.Layer<never, unknown, never> | undefined;
  readonly onUnhandledError?: (cause: unknown) => void;
};

const toWalletProvider = (value: unknown): WalletProvider | undefined => {
  if (
    typeof value === "object" &&
    value !== null &&
    "request" in value &&
    typeof (value as { request?: unknown }).request === "function"
  ) {
    return value as WalletProvider;
  }
  return undefined;
};

const WagmiWalletProviderRefSync = (props: { readonly config: Config }): null => {
  const { config } = props;
  const { clearProvider, setProvider } = useWalletProviderRef();

  React.useEffect(() => {
    let cancelled = false;

    const sync = async (account: ReturnType<typeof getAccount>): Promise<void> => {
      if (!account.connector || account.chainId === undefined) {
        clearProvider();
        return;
      }

      try {
        const raw = await account.connector.getProvider({
          chainId: account.chainId,
        });
        const provider = toWalletProvider(raw);
        if (cancelled) {
          return;
        }

        if (provider) {
          setProvider(provider);
        } else {
          clearProvider();
        }
      } catch {
        if (!cancelled) {
          clearProvider();
        }
      }
    };

    void sync(getAccount(config));

    const unsubscribe = watchAccount(config, {
      onChange: (next) => {
        void sync(next);
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
      clearProvider();
    };
  }, [clearProvider, config, setProvider]);

  return null;
};

export const WagmiEffectEvmProvider = (props: WagmiEffectEvmProviderProps): React.ReactElement => {
  const { children, config, fallback, layer: extraLayer, onUnhandledError } = props;

  const baseLayer = React.useMemo(
    () => makeEffectEvmLayerFromWagmiWithWalletProviderRef(config),
    [config]
  );
  const fullLayer = React.useMemo(
    () => (extraLayer ? Layer.mergeAll(baseLayer, extraLayer) : baseLayer),
    [baseLayer, extraLayer]
  );

  return React.createElement(
    EffectEvmProvider,
    {
      fallback,
      layer: fullLayer,
      onUnhandledError,
    },
    React.createElement(
      React.Fragment,
      null,
      React.createElement(WagmiWalletProviderRefSync, { config }),
      children
    )
  );
};

export const WagmiEffectEvmProviderSync = (
  props: WagmiEffectEvmProviderProps
): React.ReactElement => {
  const { children, config, layer: extraLayer, onUnhandledError } = props;

  const baseLayer = React.useMemo(
    () => makeEffectEvmLayerFromWagmiWithWalletProviderRef(config),
    [config]
  );
  const fullLayer = React.useMemo(
    () => (extraLayer ? Layer.mergeAll(baseLayer, extraLayer) : baseLayer),
    [baseLayer, extraLayer]
  );

  return React.createElement(
    EffectEvmProviderSync,
    {
      layer: fullLayer,
      onUnhandledError,
    },
    React.createElement(
      React.Fragment,
      null,
      React.createElement(WagmiWalletProviderRefSync, { config }),
      children
    )
  );
};
