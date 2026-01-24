/**
 * On-chain execution and decoding helpers for Safe simulation.
 */
import { Effect } from "effect";
import type { Address, Hex, PublicClient } from "viem";
import { BaseError as CoreError } from "viem";
import { decodeSimulationData } from "../../encoding.js";
import { SafeMultisigSimulationFailedError, SimulationDecodeError } from "../../errors.js";
import type { LatestBlock, SimulationDecoded } from "../types/index.js";

/**
 * Extract revert data from a viem CoreError tree, if present.
 */
export function extractRevertData(error: unknown): string | undefined {
  if (!(error instanceof CoreError)) {
    return undefined;
  }

  const revertError = error.walk((err) => {
    const typedErr = err as unknown as Record<string, unknown>;
    return typeof typedErr.data === "string";
  });

  if (!revertError) {
    return undefined;
  }

  const typedErr = revertError as unknown as Record<string, unknown>;
  const extractedData = typedErr.data;
  return typeof extractedData === "string" ? extractedData : undefined;
}

/**
 * Execute simulateAndRevert and return the revert data payload.
 */
export async function callSimulateAndExtractRevertData(
  client: PublicClient,
  safeAddress: Address,
  safeCalldata: Hex
): Promise<string> {
  try {
    await client.call({
      account: safeAddress,
      data: safeCalldata,
      to: safeAddress,
    });
    throw new Error("simulateAndRevert did not revert");
  } catch (error: unknown) {
    const revertData = extractRevertData(error);
    if (revertData) {
      return revertData;
    }
    throw error;
  }
}

/**
 * Run the on-chain call and decode the revert payload into a gas estimate.
 */
export function simulateAndDecode(
  client: PublicClient,
  safeAddress: Address,
  safeCalldata: Hex
): Effect.Effect<SimulationDecoded, SafeMultisigSimulationFailedError | SimulationDecodeError> {
  return Effect.gen(function* () {
    const revertData = yield* Effect.tryPromise({
      catch: (error) =>
        new SafeMultisigSimulationFailedError({
          cause: error,
          message: "Network error or unexpected behavior during simulation",
        }),
      try: () => callSimulateAndExtractRevertData(client, safeAddress, safeCalldata),
    });

    return yield* Effect.try({
      catch: (error) =>
        new SimulationDecodeError({
          cause: error,
          message: "Failed to decode simulation revert data - unexpected format",
          revertData,
        }),
      try: () => decodeSimulationData(revertData),
    });
  });
}

/**
 * Fetch the latest block to derive the gas threshold.
 */
export function fetchLatestBlock(
  client: PublicClient
): Effect.Effect<LatestBlock, SafeMultisigSimulationFailedError> {
  return Effect.tryPromise({
    catch: (e) =>
      new SafeMultisigSimulationFailedError({
        cause: e,
        message: `Failed to fetch block: ${e}`,
      }),
    try: () => client.getBlock({ blockTag: "latest" }),
  });
}
