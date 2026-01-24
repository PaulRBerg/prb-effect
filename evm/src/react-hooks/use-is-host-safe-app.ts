"use client";

import { useSyncExternalStore } from "react";
import {
  isHostEmbedded,
  isValidSafeAppOrigin,
  subscribeSafeAppOrigins,
} from "./safe-app-origins.js";
import { useIsSafeAppContext } from "./use-is-safe-app-context.js";

/**
 * Detect if the app is running within a Safe App context.
 *
 * This hook returns `true` when either:
 * - Safe Apps SDK confirms the Safe context (async, most reliable), or
 * - The app is embedded in a Safe App-origin iframe (sync check).
 *
 * Notes:
 * - This answers “is the host Safe App?” and will return true even without a wallet.
 * - For full wallet detection heuristics, use `useIsSafeMultisigWallet`.
 * - For SDK-only checks, use `useIsSafeAppContext`.
 */
export function useIsHostSafeApp(): boolean {
  const isSafeContext = useIsSafeAppContext();
  const isSafeHost = useSyncExternalStore(
    subscribeSafeAppOrigins,
    getSafeHostSnapshot,
    getServerSnapshot
  );

  return isSafeContext || isSafeHost;
}

function getSafeHostSnapshot(): boolean {
  return isHostEmbedded() && isValidSafeAppOrigin();
}

function getServerSnapshot(): boolean {
  return false;
}
