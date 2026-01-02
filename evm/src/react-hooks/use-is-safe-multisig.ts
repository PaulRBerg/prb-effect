"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useSafeContext } from "./use-safe-context.js";

/**
 * Known Safe wallet domains for iframe origin validation.
 * Includes the main Safe app and chain-specific Safe deployments.
 */
const SAFE_ORIGINS = [
  // Main Safe domains
  "https://app.safe.global",
  "https://gnosis-safe.io",
  "https://safe.global",
  // Chain-specific Safe deployments
  "https://safe.berachain.com",
  "https://safe.chiliz.com",
  "https://safe.lightlink.io",
  "https://safe.optimism.io",
] as const;

/**
 * Detect if the connected wallet is a Safe multisig.
 *
 * Detection strategy (in order of reliability):
 * 1. Safe Apps SDK detection via postMessage (most reliable, works cross-origin)
 * 2. Wagmi connector ID check
 * 3. Iframe origin validation (fallback, may fail cross-origin)
 *
 * @returns true if wallet is a Safe multisig
 */
export function useIsSafeMultisig(): boolean {
  const { connector, isConnected } = useAccount();
  const isSafeContext = useSafeContext();

  // Method 3: Iframe origin fallback (may fail cross-origin)
  // Deferred to useEffect to avoid SSR hydration mismatch
  const [isSafeIframe, setIsSafeIframe] = useState(false);
  useEffect(() => {
    if (window.parent !== window && isValidSafeOrigin()) {
      setIsSafeIframe(true);
    }
  }, []);

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

/**
 * Check if the parent window origin matches known Safe domains.
 * This prevents false positives from other iframe contexts.
 */
function isValidSafeOrigin(): boolean {
  try {
    // Try to access parent origin (may throw SecurityError for cross-origin)
    const parentOrigin = window.parent.location.origin;
    return SAFE_ORIGINS.some((origin) => parentOrigin === origin);
  } catch {
    // Cross-origin access blocked - check ancestorOrigins if available
    if (window.location.ancestorOrigins?.length) {
      const ancestorOrigin = window.location.ancestorOrigins[0];
      return SAFE_ORIGINS.some((origin) => ancestorOrigin === origin);
    }
    // Cannot determine origin - default to false to avoid false positives
    return false;
  }
}
