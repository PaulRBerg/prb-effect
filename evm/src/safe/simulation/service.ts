/**
 * Safe batch simulation service using Effect-TS.
 *
 * Simulates Safe multisig batch transactions to estimate gas consumption before execution.
 * Uses Safe's simulateAndRevert algorithm to get accurate gas estimates.
 *
 * @see https://github.com/safe-global/safe-smart-account/blob/c4859f4/contracts/common/StorageAccessible.sol#L32-L43
 */

import { Context, Effect, Layer } from "effect";
import type { ClientNotFoundError } from "@/src/core/index.js";
import { PublicClientService } from "@/src/core/index.js";
import type {
  GasLimitOverflowError,
  InvalidGasThresholdError,
  SafeContractsNotDeployedError,
  SafeSimulationFailedError,
  SimulationDecodeError,
  TransactionSizeTooLargeError,
} from "./errors.js";
import { buildSafeCalldata } from "./internal/calldata/index.js";
import { resolveSafeContracts } from "./internal/contracts/index.js";
import { evaluateSimulationResult } from "./internal/evaluation/index.js";
import { fetchLatestBlock, simulateAndDecode } from "./internal/execution/index.js";
import { enforceTxSizeLimit } from "./internal/limits/index.js";
import { validateSimulationParams } from "./internal/validation/index.js";
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

export const SafeSimulationServiceLive = Layer.effect(
  SafeSimulationService,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    return SafeSimulationService.of({
      simulateBatch: (params: SafeSimulateBatchParams) =>
        Effect.gen(function* () {
          const { chainId, safeAddress, transactions, txSizeLimit, gasThresholdPercent } =
            yield* validateSimulationParams(params);
          const contracts = yield* resolveSafeContracts(chainId);
          const safeCalldata = buildSafeCalldata(contracts, transactions);

          yield* enforceTxSizeLimit(safeCalldata, txSizeLimit);

          const client = yield* publicClientService.get(chainId);
          const [result, block] = yield* Effect.all(
            [simulateAndDecode(client, safeAddress, safeCalldata), fetchLatestBlock(client)],
            { concurrency: "unbounded" }
          );

          return yield* evaluateSimulationResult(result, block, gasThresholdPercent);
        }),
    });
  })
);
