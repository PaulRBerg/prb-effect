"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
import { NotInSafeAppContextError } from "../safe/errors.js";
import {
  isHostEmbedded,
  isValidSafeAppOrigin,
  subscribeSafeAppOrigins,
} from "./safe-app-origins.js";
import { useIsSafeAppContext } from "./use-is-safe-app-context.js";

const safeOwnersAbi = [
  {
    inputs: [],
    name: "getOwners",
    outputs: [{ name: "", type: "address[]" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

export type WalletExecutionDetectionSource =
  | "safe-context"
  | "safe-connector"
  | "safe-origin"
  | "owners-probe"
  | "none";

export type WalletExecutionHost = "safe" | "browser";

export type WalletExecutionType = "safe-multisig" | "eoa" | "unknown";

export type SafeAppsExecutionSource = "safe-context" | "safe-origin";

export type SafeAppsExecution =
  | {
      readonly available: true;
      readonly host: "safe-app";
      readonly source: SafeAppsExecutionSource;
    }
  | {
      readonly available: false;
      readonly host: "browser";
      readonly reason: "not-safe-app-host";
    };

export type WalletExecution = {
  /** True when Safe Apps SDK submission can be used immediately. */
  readonly canUseSafeAppsSdk: boolean;
  readonly detectionSource: WalletExecutionDetectionSource;
  /**
   * Host context where Safe Apps SDK execution is available.
   *
   * This is independent from `walletType`: a Safe multisig detected in a normal
   * browser session is still a Safe wallet, but cannot submit through Safe Apps SDK.
   */
  readonly host: WalletExecutionHost;
  readonly isSafeMultisig: boolean;
  /** Detailed Safe Apps SDK execution capability. */
  readonly safeAppsExecution: SafeAppsExecution;
  readonly walletType: WalletExecutionType;
};

export type WalletExecutionOptions = {
  readonly enableOwnersProbe?: boolean;
};

/**
 * Unified wallet execution detection for Safe vs EOA routing.
 */
export function useWalletExecution(options: WalletExecutionOptions = {}): WalletExecution {
  const { address, connector, isConnected } = useAccount();
  const publicClient = usePublicClient() as PublicClient | undefined;
  const isSafeContext = useIsSafeAppContext();
  const isSafeOrigin = useSyncExternalStore(
    subscribeSafeAppOrigins,
    getSafeHostSnapshot,
    getServerSnapshot
  );

  const enableOwnersProbe = options.enableOwnersProbe ?? true;
  const [ownersProbeDetectedSafe, setOwnersProbeDetectedSafe] = useState(false);

  const isSafeConnector = isConnected && connector?.id === "safe";

  useEffect(() => {
    if (
      !enableOwnersProbe ||
      !address ||
      !isConnected ||
      !publicClient ||
      isSafeContext ||
      isSafeConnector ||
      isSafeOrigin
    ) {
      setOwnersProbeDetectedSafe(false);
      return;
    }

    let cancelled = false;

    void publicClient
      .readContract({
        abi: safeOwnersAbi,
        address,
        functionName: "getOwners",
      })
      .then((owners) => {
        if (!cancelled) {
          setOwnersProbeDetectedSafe(Array.isArray(owners) && owners.length > 0);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOwnersProbeDetectedSafe(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    address,
    enableOwnersProbe,
    isConnected,
    isSafeConnector,
    isSafeContext,
    isSafeOrigin,
    publicClient,
  ]);

  return useMemo(() => {
    const safeAppsExecution = resolveSafeAppsExecution({
      isSafeContext,
      isSafeOrigin,
    });
    const host = safeAppsExecution.available ? "safe" : "browser";

    if (isSafeContext) {
      return {
        canUseSafeAppsSdk: safeAppsExecution.available,
        detectionSource: "safe-context",
        host,
        isSafeMultisig: true,
        safeAppsExecution,
        walletType: "safe-multisig",
      } satisfies WalletExecution;
    }

    if (isSafeOrigin) {
      return {
        canUseSafeAppsSdk: safeAppsExecution.available,
        detectionSource: "safe-origin",
        host,
        isSafeMultisig: true,
        safeAppsExecution,
        walletType: "safe-multisig",
      } satisfies WalletExecution;
    }

    if (isSafeConnector) {
      return {
        canUseSafeAppsSdk: safeAppsExecution.available,
        detectionSource: "safe-connector",
        host,
        isSafeMultisig: true,
        safeAppsExecution,
        walletType: "safe-multisig",
      } satisfies WalletExecution;
    }

    if (ownersProbeDetectedSafe) {
      return {
        canUseSafeAppsSdk: safeAppsExecution.available,
        detectionSource: "owners-probe",
        host,
        isSafeMultisig: true,
        safeAppsExecution,
        walletType: "safe-multisig",
      } satisfies WalletExecution;
    }

    return {
      canUseSafeAppsSdk: safeAppsExecution.available,
      detectionSource: "none",
      host,
      isSafeMultisig: false,
      safeAppsExecution,
      walletType: isConnected ? "eoa" : "unknown",
    } satisfies WalletExecution;
  }, [isConnected, isSafeConnector, isSafeContext, isSafeOrigin, ownersProbeDetectedSafe]);
}

export function canUseSafeAppsExecution(execution: SafeAppsExecution | WalletExecution): boolean {
  return getSafeAppsExecution(execution).available;
}

export function assertSafeAppsExecutionAvailable(
  execution: SafeAppsExecution | WalletExecution
): Extract<SafeAppsExecution, { readonly available: true }> {
  const safeAppsExecution = getSafeAppsExecution(execution);

  if (safeAppsExecution.available) {
    return safeAppsExecution;
  }

  throw new NotInSafeAppContextError({
    code: "TOP_LEVEL_WINDOW",
    message: "Safe Apps SDK requires the page to be embedded in a Safe App host",
    recovery: "open-in-safe",
    userMessage: "Open this flow in Safe to use Safe Apps SDK execution.",
  });
}

function getSafeAppsExecution(execution: SafeAppsExecution | WalletExecution): SafeAppsExecution {
  return "safeAppsExecution" in execution ? execution.safeAppsExecution : execution;
}

function resolveSafeAppsExecution(options: {
  isSafeContext: boolean;
  isSafeOrigin: boolean;
}): SafeAppsExecution {
  if (options.isSafeContext) {
    return { available: true, host: "safe-app", source: "safe-context" };
  }

  if (options.isSafeOrigin) {
    return { available: true, host: "safe-app", source: "safe-origin" };
  }

  return { available: false, host: "browser", reason: "not-safe-app-host" };
}

function getSafeHostSnapshot(): boolean {
  return isHostEmbedded() && isValidSafeAppOrigin();
}

function getServerSnapshot(): boolean {
  return false;
}
