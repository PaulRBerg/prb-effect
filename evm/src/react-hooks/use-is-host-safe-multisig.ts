"use client";

import { useSyncExternalStore } from "react";
import { isHostEmbedded, isValidSafeOrigin, subscribeSafeOrigins } from "./safe-origins.js";
import { useSafeContext } from "./use-safe-context.js";

/**
 * Detect if the app is running within a Safe context.
 *
 * This hook returns `true` when either:
 * - Safe Apps SDK confirms the Safe context (async, most reliable), or
 * - The app is embedded in a Safe-origin iframe (sync check).
 *
 * Notes:
 * - This answers “is the host Safe?” and will return true even without a wallet.
 * - For full wallet detection heuristics, use `useIsWalletSafeMultisig`.
 * - For SDK-only checks, use `useSafeContext`.
 */
export function useIsHostSafeMultisig(): boolean {
  const isSafeContext = useSafeContext();
  const isSafeHost = useSyncExternalStore(
    subscribeSafeOrigins,
    getSafeHostSnapshot,
    getServerSnapshot
  );

  return isSafeContext || isSafeHost;
}

function getSafeHostSnapshot(): boolean {
  return isHostEmbedded() && isValidSafeOrigin();
}

function getServerSnapshot(): boolean {
  return false;
}
