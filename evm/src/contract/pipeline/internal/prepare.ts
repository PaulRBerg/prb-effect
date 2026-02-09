import { Effect } from "effect";
import type { Abi } from "viem";
import type { ContractWriterShape } from "#src/contract/index.js";
import type {
  ClientNotFoundError,
  ContractReadError,
  GasEstimationError,
  InsufficientFundsError,
  SimulationFailedError,
  UserRejectedError,
} from "#src/core/index.js";
import type { GasPriceUnavailableError, GasServiceShape } from "#src/gas/index.js";
import { GasService } from "#src/gas/index.js";
import type { TxPolicy } from "#src/tx/index.js";
import { deriveFeeOverrides, deriveTxType } from "#src/tx/index.js";
import type {
  ContractFunctionName,
  FeeOverrides,
  TxOverrides,
  WriteParams,
} from "#src/types/index.js";
import { applyGasLimitMultiplier } from "./helpers.js";

export type BaseOverrides = TxOverrides & FeeOverrides;

/**
 * Derive transaction type and fee overrides in parallel
 */
export const deriveBaseOverrides = (
  gasService: GasServiceShape,
  params: {
    chainId: number;
    policy: TxPolicy;
    userOverrides?: TxOverrides;
  }
): Effect.Effect<BaseOverrides, GasPriceUnavailableError | ClientNotFoundError, never> =>
  Effect.gen(function* () {
    const [derivedType, feeOverrides] = yield* Effect.all(
      [
        deriveTxType({
          chainId: params.chainId,
          policy: params.policy,
          userOverrides: params.userOverrides,
        }).pipe(Effect.provideService(GasService, gasService)),

        deriveFeeOverrides({
          chainId: params.chainId,
          policy: params.policy,
          userOverrides: params.userOverrides,
        }).pipe(Effect.provideService(GasService, gasService)),
      ],
      { concurrency: 2 }
    );

    return {
      ...params.userOverrides,
      ...feeOverrides,
      type: params.userOverrides?.type ?? derivedType,
    } as BaseOverrides;
  });

/**
 * Estimate gas and simulate transaction.
 *
 * Gas estimation is done BEFORE simulation to provide a reasonable gas limit.
 * Some RPC nodes default to max uint64 when no gas limit is provided, which
 * causes "insufficient funds" errors during the balance check.
 */
export const simulateAndEstimate = <
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
>(
  writer: ContractWriterShape,
  params: WriteParams<TAbi, TFunctionName>,
  baseOverrides: BaseOverrides,
  policy: TxPolicy
): Effect.Effect<
  { finalGas: bigint; overridesWithGas: BaseOverrides & { gas: bigint } },
  | SimulationFailedError
  | ContractReadError
  | GasEstimationError
  | ClientNotFoundError
  | InsufficientFundsError
  | UserRejectedError
> =>
  Effect.gen(function* () {
    // Estimate gas first to get a reasonable limit for simulation
    const estimatedGas = yield* writer.estimateGas({
      ...params,
      overrides: baseOverrides,
    });
    // Apply multiplier to add safety margin; this buffered value is used for
    // both simulation (balance check) and the final transaction.
    const derivedGas = applyGasLimitMultiplier(estimatedGas, policy.gasLimitMultiplier);

    // Use explicit gas if provided, otherwise use derived
    const explicitGas = params.overrides?.gas ?? params.gas;
    const finalGas = explicitGas ?? derivedGas;

    // Simulate with the gas limit to ensure proper balance checks
    yield* writer.simulate({ ...params, overrides: { ...baseOverrides, gas: finalGas } });

    return {
      finalGas,
      overridesWithGas: {
        ...baseOverrides,
        gas: finalGas,
      },
    };
  });
