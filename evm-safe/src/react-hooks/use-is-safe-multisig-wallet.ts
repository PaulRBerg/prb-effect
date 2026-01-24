"use client";

import { useSyncExternalStore } from "react";
import { useAccount } from "wagmi";
import {
  isHostEmbedded,
  isValidSafeAppOrigin,
  subscribeSafeAppOrigins,
} from "./safe-app-origins.js";
import { useIsSafeAppContext } from "./use-is-safe-app-context.js";

/**
 * Detect if the connected wallet is a Safe multisig wallet.
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
 * - For just SDK context, use `useIsSafeAppContext`.
 * - For a sync host-only check, use `useIsHostSafeApp`.
 */
export function useIsSafeMultisigWallet(): boolean {
  const { connector, isConnected } = useAccount();
  const isSafeContext = useIsSafeAppContext();

  // Method 3: Iframe origin fallback (may fail cross-origin)
  const isSafeIframe = useSyncExternalStore(
    subscribeSafeAppOrigins,
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
  return isHostEmbedded() && isValidSafeAppOrigin();
}

function getServerSnapshot(): boolean {
  return false;
}
