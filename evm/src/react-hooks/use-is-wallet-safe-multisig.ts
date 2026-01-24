"use client";

import { useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import { isHostEmbedded, isValidSafeOrigin, subscribeSafeOrigins } from "./safe-origins.js";
import { useSafeContext } from "./use-safe-context.js";

/**
 * Detect if the connected wallet is a Safe multisig.
 *
 * Detection strategy (in order of reliability):
 * 1. Safe Apps SDK detection via postMessage (most reliable, works cross-origin)
 * 2. Wagmi connector ID check
 * 3. Iframe origin validation (fallback, may fail cross-origin)
 *
 * @returns true if wallet is a Safe multisig
 *
 * Notes:
 * - This is a broader heuristic: SDK context, connector ID, then host origin.
 * - For just SDK context, use `useSafeContext`.
 * - For a sync host-only check, use `useIsHostSafeMultisig`.
 */
export function useIsWalletSafeMultisig(): boolean {
  const { connector, isConnected } = useAccount();
  const isSafeContext = useSafeContext();

  // Method 3: Iframe origin fallback (may fail cross-origin)
  const isSafeIframe = useSyncExternalStore(
    subscribeSafeOrigins,
    getSafeIframeSnapshot,
    getServerSnapshot
  );

  // Method 1: Safe Apps SDK (most reliable - uses postMessage)
  if (isSafeContext) {
    return true;
  }

  // Method 2: Connected via Safe connector
  if (isConnected && connector?.id === "safe") {
    return true;
  }

  // Method 3: Fallback
  return isSafeIframe;
}

function getSafeIframeSnapshot(): boolean {
  return isHostEmbedded() && isValidSafeOrigin();
}

function getServerSnapshot(): boolean {
  return false;
}
