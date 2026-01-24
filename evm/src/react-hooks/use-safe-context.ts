"use client";

import { useEffect, useState } from "react";

/**
 * Timeout for Safe SDK detection in milliseconds.
 * Safe Apps SDK uses postMessage which can hang if not in Safe context.
 */
const SAFE_SDK_TIMEOUT = 3000;

/**
 * Detect if the app is running in a Safe App context using the Safe Apps SDK.
 *
 * This hook asynchronously checks with the Safe Apps SDK to determine if
 * we're running inside a Safe App iframe. More reliable than iframe origin
 * detection because:
 * - Uses postMessage (works cross-origin)
 * - Gets definitive answer from Safe
 * - Includes timeout to prevent hangs
 *
 * @returns true if running in Safe App context, false otherwise
 *
 * Notes:
 * - This only verifies the Safe Apps SDK context (async).
 * - For a host-based sync check, use `useIsHostSafeMultisig`.
 * - For a full wallet detection heuristic, use `useIsWalletSafeMultisig`.
 *
 * @example
 * ```tsx
 * function MyComponent() {
 *   const isSafeContext = useSafeContext();
 *
 *   if (isSafeContext) {
 *     return <p>Running in Safe App</p>;
 *   }
 *   return <p>Regular browser context</p>;
 * }
 * ```
 */
export function useSafeContext(): boolean {
  const [isSafe, setIsSafe] = useState(false);

  useEffect(() => {
    // SSR guard
    if (typeof window === "undefined") {
      return;
    }

    let cancelled = false;

    // Timeout fallback - resolve to false if SDK doesn't respond
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setIsSafe(false);
      }
    }, SAFE_SDK_TIMEOUT);

    // Dynamically import SDK to keep it optional
    import("@safe-global/safe-apps-sdk")
      .then(({ default: SafeAppsSDK }) => {
        const sdk = new SafeAppsSDK();
        return sdk.safe.getInfo();
      })
      .then(() => {
        if (!cancelled) {
          setIsSafe(true);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setIsSafe(false);
        }
      })
      .finally(() => {
        clearTimeout(timeout);
      });

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, []);

  return isSafe;
}
