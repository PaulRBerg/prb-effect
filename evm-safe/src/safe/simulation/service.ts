/**
 * Safe batch simulation service using Effect-TS.
 *
 * Simulates Safe multisig batch transactions to estimate gas consumption before execution.
 * Uses Safe's simulateAndRevert algorithm to get accurate gas estimates.
 *
 * @see https://github.com/safe-global/safe-smart-account/blob/c4859f4/contracts/common/StorageAccessible.sol#L32-L43
 */

import type { ClientNotFoundError } from "@prb/effect-evm/core";
import { PublicClientService } from "@prb/effect-evm/core";
import { Context, Effect, Layer } from "effect";
import type {
  GasLimitOverflowError,
  InvalidGasThresholdError,
  SafeMultisigContractsNotDeployedError,
  SafeMultisigSimulationFailedError,
  SimulationDecodeError,
  TxSizeTooLargeError,
} from "./errors.js";
import { buildSafeCalldata } from "./internal/calldata/index.js";
import { resolveSafeMultisigContracts } from "./internal/contracts/index.js";
import { evaluateSimulationResult } from "./internal/evaluation/index.js";
import { fetchLatestBlock, simulateAndDecode } from "./internal/execution/index.js";
import { enforceTxSizeLimit } from "./internal/limits/index.js";
import { validateSimulationParams } from "./internal/validation/index.js";
import type { SafeMultisigSimulateBatchParams, SafeMultisigSimulationResult } from "./types.js";

export type SafeMultisigSimulationServiceShape = {
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
    params: SafeMultisigSimulateBatchParams
  ) => Effect.Effect<
    SafeMultisigSimulationResult,
    | ClientNotFoundError
    | InvalidGasThresholdError
    | SafeMultisigContractsNotDeployedError
    | TxSizeTooLargeError
    | SafeMultisigSimulationFailedError
    | SimulationDecodeError
    | GasLimitOverflowError
  >;
};

export class SafeMultisigSimulationService extends Context.Tag("ew3/SafeMultisigSimulation")<
  SafeMultisigSimulationService,
  SafeMultisigSimulationServiceShape
>() {}

export const SafeMultisigSimulationServiceLive = Layer.effect(
  SafeMultisigSimulationService,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    return SafeMultisigSimulationService.of({
      simulateBatch: (params: SafeMultisigSimulateBatchParams) =>
        Effect.gen(function* () {
          const { chainId, safeAddress, transactions, txSizeLimit, gasThresholdPercent } =
            yield* validateSimulationParams(params);
          const contracts = yield* resolveSafeMultisigContracts(chainId);
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
