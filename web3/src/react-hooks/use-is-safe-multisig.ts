"use client";

import { useMemo } from "react";
import { useAccount } from "wagmi";

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
 * Detection strategy:
 * 1. Check wagmi connector ID (most reliable)
 * 2. Check for Safe-specific iframe properties (avoids false positives from other iframes)
 *
 * Safe Apps inject specific properties into the window object when running in their iframe:
 * - `window.parent !== window` (iframe check)
 * - Safe domain origins: app.safe.global, gnosis-safe.io
 *
 * We avoid relying solely on `window.parent !== window` because it triggers for ANY iframe,
 * including non-Safe contexts like embedded widgets, auth popups, or third-party integrations.
 *
 * @returns true if wallet is a Safe multisig
 */
export function useIsSafeMultisig(): boolean {
  const { connector, isConnected } = useAccount();

  // Method 1: Connected via Safe connector (most reliable)
  const isSafeConnector = isConnected && connector?.id === "safe";

  // Method 2: Running in Safe App iframe
  // Check for Safe-specific iframe context to avoid false positives
  // Memoized because iframe status and parent origin never change during a session
  const isSafeIframe = useMemo(
    () => typeof window !== "undefined" && window.parent !== window && isValidSafeOrigin(),
    []
  );

  return isSafeConnector || isSafeIframe;
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
