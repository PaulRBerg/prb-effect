/**
 * Safe batch simulation service using Effect-TS.
 *
 * Simulates Safe multisig batch transactions to estimate gas consumption before execution.
 * Uses Safe's simulateAndRevert algorithm to get accurate gas estimates.
 *
 * @see https://github.com/safe-global/safe-smart-account/blob/c4859f4/contracts/common/StorageAccessible.sol#L32-L43
 */

import { Context, Effect, Layer } from "effect";
import type { Address, Hex, PublicClient } from "viem";
import { BaseError as CoreError, encodeFunctionData, zeroAddress } from "viem";
import type { ClientNotFoundError } from "@/src/core/index.js";
import { PublicClientService } from "@/src/core/index.js";
import { safeAbis } from "./abis.js";
import { getMultiSendAddress, getSimulateAccessorAddress } from "./addresses.js";
import { decodeSimulationData, encodeMultiSend } from "./encoding.js";
import {
  GasLimitOverflowError,
  InvalidGasThresholdError,
  SafeContractsNotDeployedError,
  SafeSimulationFailedError,
  SimulationDecodeError,
  TransactionSizeTooLargeError,
} from "./errors.js";
import type { SafeSimulateBatchParams, SafeSimulationResult } from "./types.js";

export type SafeSimulationServiceShape = {
  /**
   * Simulate a batch of transactions in Safe context.
   *
   * Uses simulateAndRevert algorithm to estimate gas consumption. This always reverts,
   * and we decode the revert data to extract the gas estimate.
   *
   * @param params - Simulation parameters including chainId, safeAddress, and transactions
   * @returns Gas estimate and success flag
   */
  readonly simulateBatch: (
    params: SafeSimulateBatchParams
  ) => Effect.Effect<
    SafeSimulationResult,
    | ClientNotFoundError
    | InvalidGasThresholdError
    | SafeContractsNotDeployedError
    | TransactionSizeTooLargeError
    | SafeSimulationFailedError
    | SimulationDecodeError
    | GasLimitOverflowError
  >;
};

export class SafeSimulationService extends Context.Tag("ew3/SafeSimulation")<
  SafeSimulationService,
  SafeSimulationServiceShape
>() {}

function extractRevertData(error: unknown): string | undefined {
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

async function callSimulateAndExtractRevertData(
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

export const SafeSimulationServiceLive = Layer.effect(
  SafeSimulationService,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    return SafeSimulationService.of({
      simulateBatch: (params: SafeSimulateBatchParams) =>
        // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: Safe simulation requires validation and multi-step orchestration
        Effect.gen(function* () {
          const { chainId, safeAddress, transactions, txSizeLimit, gasThresholdPercent } = params;

          // 0. Validate inputs
          if (transactions.length === 0) {
            return yield* Effect.fail(
              new SafeSimulationFailedError({
                message: "Cannot simulate empty transaction batch",
              })
            );
          }

          if (safeAddress === zeroAddress) {
            return yield* Effect.fail(
              new SafeSimulationFailedError({
                message: "Invalid Safe address: cannot be zero address",
              })
            );
          }

          if (
            gasThresholdPercent !== undefined &&
            (gasThresholdPercent < 1 || gasThresholdPercent > 100)
          ) {
            return yield* Effect.fail(
              new InvalidGasThresholdError({
                message: "gasThresholdPercent must be between 1 and 100 (inclusive)",
                value: gasThresholdPercent,
              })
            );
          }

          // 1. Check Safe contracts are deployed
          const multiSendAddr = getMultiSendAddress(chainId);
          const simulateAccessorAddr = getSimulateAccessorAddress(chainId);

          if (!multiSendAddr) {
            return yield* Effect.fail(
              new SafeContractsNotDeployedError({
                chainId,
                message: "MultiSend contract not deployed on this chain",
                missingContract: "multiSend",
              })
            );
          }

          if (!simulateAccessorAddr) {
            return yield* Effect.fail(
              new SafeContractsNotDeployedError({
                chainId,
                message: "SimulateAccessor contract not deployed on this chain",
                missingContract: "simulateAccessor",
              })
            );
          }

          // 2. Encode multiSend calldata
          const multiSendCalldata = encodeMultiSend(transactions);

          // 3. Encode simulateAccessor.simulate() calldata
          const simulateAccessorCalldata = encodeFunctionData({
            abi: safeAbis.simulateAccessor,
            args: [multiSendAddr, 0n, multiSendCalldata, 1], // 1 = DelegateCall
            functionName: "simulate",
          });

          // 4. Encode safe.simulateAndRevert() calldata
          const safeCalldata = encodeFunctionData({
            abi: safeAbis.multisig,
            args: [simulateAccessorAddr, simulateAccessorCalldata],
            functionName: "simulateAndRevert",
          });

          // 5. Check transaction size limit for ZK rollups
          if (txSizeLimit) {
            // Calculate size in bytes (remove "0x" prefix and divide by 2)
            const sizeInBytes = (safeCalldata.length - 2) / 2;
            if (sizeInBytes > txSizeLimit) {
              return yield* Effect.fail(
                new TransactionSizeTooLargeError({
                  actualSize: sizeInBytes,
                  maxSize: txSizeLimit,
                  message: `Transaction size (${sizeInBytes} bytes) exceeds chain limit (${txSizeLimit} bytes). Try splitting into smaller batches.`,
                })
              );
            }
          }

          // 6. Get public client
          const client = yield* publicClientService.get(chainId);

          // 7. Execute simulation call and fetch block in parallel
          const simulationEffect = Effect.gen(function* () {
            // Execute the simulation call
            const revertData = yield* Effect.tryPromise({
              catch: (error) =>
                new SafeSimulationFailedError({
                  cause: error,
                  message: "Network error or unexpected behavior during simulation",
                }),
              try: () => callSimulateAndExtractRevertData(client, safeAddress, safeCalldata),
            });

            // Decode the revert data
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

          const [result, block] = yield* Effect.all(
            [
              simulationEffect,
              Effect.tryPromise({
                catch: (e) =>
                  new SafeSimulationFailedError({
                    cause: e,
                    message: `Failed to fetch block: ${e}`,
                  }),
                try: () => client.getBlock({ blockTag: "latest" }),
              }),
            ],
            { concurrency: "unbounded" }
          );

          // 8. Check if gas exceeds threshold
          const threshold = (block.gasLimit * BigInt(params.gasThresholdPercent ?? 95)) / 100n;

          if (result.success && result.gas > threshold) {
            return yield* Effect.fail(
              new GasLimitOverflowError({
                blockGasLimit: block.gasLimit,
                estimatedGas: result.gas,
                message:
                  "Gas consumption exceeds threshold of block gas limit. Try splitting into smaller batches.",
                threshold,
              })
            );
          }

          if (!result.success) {
            return yield* Effect.fail(
              new SafeSimulationFailedError({
                message: "Transaction simulation failed - the transaction would revert",
              })
            );
          }

          return { estimatedGas: result.gas, success: true };
        }),
    });
  })
);
