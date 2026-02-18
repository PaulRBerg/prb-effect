"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import type { PublicClient } from "viem";
import { useAccount, usePublicClient } from "wagmi";
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

export type WalletExecution = {
  readonly detectionSource: WalletExecutionDetectionSource;
  readonly host: WalletExecutionHost;
  readonly isSafeMultisig: boolean;
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
    if (isSafeContext) {
      return {
        detectionSource: "safe-context",
        host: "safe",
        isSafeMultisig: true,
        walletType: "safe-multisig",
      } satisfies WalletExecution;
    }

    if (isSafeConnector) {
      return {
        detectionSource: "safe-connector",
        host: "safe",
        isSafeMultisig: true,
        walletType: "safe-multisig",
      } satisfies WalletExecution;
    }

    if (isSafeOrigin) {
      return {
        detectionSource: "safe-origin",
        host: "safe",
        isSafeMultisig: true,
        walletType: "safe-multisig",
      } satisfies WalletExecution;
    }

    if (ownersProbeDetectedSafe) {
      return {
        detectionSource: "owners-probe",
        host: "browser",
        isSafeMultisig: true,
        walletType: "safe-multisig",
      } satisfies WalletExecution;
    }

    return {
      detectionSource: "none",
      host: "browser",
      isSafeMultisig: false,
      walletType: isConnected ? "eoa" : "unknown",
    } satisfies WalletExecution;
  }, [isConnected, isSafeConnector, isSafeContext, isSafeOrigin, ownersProbeDetectedSafe]);
}

function getSafeHostSnapshot(): boolean {
  return isHostEmbedded() && isValidSafeAppOrigin();
}

function getServerSnapshot(): boolean {
  return false;
}
