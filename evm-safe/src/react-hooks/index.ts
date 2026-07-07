"use client";

export {
  DEFAULT_SAFE_APP_ORIGINS,
  extendSafeAppOrigins,
  getSafeAppOrigins,
  setSafeAppOrigins,
} from "./safe-app-origins.js";
export { useIsHostSafeApp } from "./use-is-host-safe-app.js";
export { useIsSafeAppContext } from "./use-is-safe-app-context.js";
export { useIsSafeMultisigWallet } from "./use-is-safe-multisig-wallet.js";
export {
  assertSafeAppsExecutionAvailable,
  canUseSafeAppsExecution,
  type SafeAppsExecution,
  type SafeAppsExecutionSource,
  useWalletExecution,
  type WalletExecution,
  type WalletExecutionDetectionSource,
  type WalletExecutionHost,
  type WalletExecutionOptions,
  type WalletExecutionType,
} from "./use-wallet-execution.js";
