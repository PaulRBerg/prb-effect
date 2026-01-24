"use client";

export type {
  EffectMemoOptions,
  StreamState,
  UseEffectResult,
} from "@/src/integrations/react-hooks/primitives.js";
export {
  useEffectMemo,
  useEffectMemoFactory,
  useEffectOnce,
  useForkEffect,
  useStream,
  useStreamEffect,
  useStreamValue,
  useSubscriptionRef,
  useSubscriptionRefValue,
} from "@/src/integrations/react-hooks/primitives.js";
export type {
  EffectEvmLayerProviderProps,
  EffectEvmProviderProps,
} from "@/src/integrations/react-hooks/provider.js";
export {
  EffectEvmLayerProvider,
  EffectEvmProvider,
  EffectEvmProviderSync,
  useEffectEvmLayer,
  useEffectEvmRuntime,
} from "@/src/integrations/react-hooks/provider.js";
export type { WalletProviderRefActions } from "@/src/integrations/react-hooks/wallet-provider-ref.js";
export { useWalletProviderRef } from "@/src/integrations/react-hooks/wallet-provider-ref.js";
export {
  DEFAULT_SAFE_APP_ORIGINS,
  extendSafeAppOrigins,
  getSafeAppOrigins,
  setSafeAppOrigins,
} from "./safe-app-origins.js";
export { useIsHostSafeApp } from "./use-is-host-safe-app.js";
export { useIsSafeAppContext } from "./use-is-safe-app-context.js";
export { useIsSafeMultisigWallet } from "./use-is-safe-multisig-wallet.js";
