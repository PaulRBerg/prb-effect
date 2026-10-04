import { Effect } from "effect";
import type { Abi } from "viem";
import type { ContractWriterShape } from "#src/contract/index.js";
import type {
  ClientNotFoundError,
  ContractReadError,
  GasEstimationError,
  InsufficientFundsError,
  ResourceExhaustionError,
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
import type { PreflightMode } from "../types.js";
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

type PreflightError =
  | SimulationFailedError
  | ContractReadError
  | GasEstimationError
  | ClientNotFoundError
  | InsufficientFundsError
  | ResourceExhaustionError
  | UserRejectedError;

export type PreflightWarning = {
  readonly phase: "estimate" | "simulate";
  readonly reason?: string;
  readonly customErrorName?: string;
};

export type PreflightResult = {
  readonly finalGas?: bigint;
  readonly overridesWithGas: BaseOverrides & { gas?: bigint };
  readonly preflightWarning?: PreflightWarning;
};

type RunPreflightOptions = {
  readonly mode?: PreflightMode;
  readonly onSimulating?: () => Effect.Effect<void>;
};

function withGas(baseOverrides: BaseOverrides, gas?: bigint): BaseOverrides & { gas?: bigint } {
  return gas == null ? { ...baseOverrides } : { ...baseOverrides, gas };
}

function isRecoverablePreflightError(
  error: PreflightError
): error is GasEstimationError | SimulationFailedError {
  return error._tag === "SimulationFailedError" || error._tag === "GasEstimationError";
}

function toPreflightWarning(error: GasEstimationError | SimulationFailedError): PreflightWarning {
  return {
    customErrorName: error.customErrorName,
    phase: error.phase,
    reason: error.revertReason ?? error.message,
  };
}

const simulateAndEstimateStrict = <
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
>(
  writer: ContractWriterShape,
  params: WriteParams<TAbi, TFunctionName>,
  baseOverrides: BaseOverrides,
  policy: TxPolicy,
  onSimulating?: () => Effect.Effect<void>
): Effect.Effect<
  { finalGas: bigint; overridesWithGas: BaseOverrides & { gas: bigint } },
  PreflightError
> =>
  Effect.gen(function* () {
    const estimatedGas = yield* writer.estimateGas({
      ...params,
      overrides: baseOverrides,
    });

    const derivedGas = applyGasLimitMultiplier(estimatedGas, policy.gasLimitMultiplier);
    const explicitGas = params.overrides?.gas ?? params.gas;
    const finalGas = explicitGas ?? derivedGas;

    if (onSimulating) {
      yield* onSimulating();
    }

    yield* writer.simulate({ ...params, overrides: { ...baseOverrides, gas: finalGas } });

    return {
      finalGas,
      overridesWithGas: {
        ...baseOverrides,
        gas: finalGas,
      },
    };
  });

/**
 * Run write preflight according to mode.
 *
 * - strict: estimate + simulate, fail on either error.
 * - best-effort: continue on GasEstimationError / SimulationFailedError.
 * - none: skip estimate/simulate.
 */
export const runPreflight = <
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
>(
  writer: ContractWriterShape,
  params: WriteParams<TAbi, TFunctionName>,
  baseOverrides: BaseOverrides,
  policy: TxPolicy,
  options: RunPreflightOptions = {}
): Effect.Effect<PreflightResult, PreflightError> =>
  Effect.gen(function* () {
    const mode = options.mode ?? "strict";
    const explicitGas = params.overrides?.gas ?? params.gas;

    if (mode === "none") {
      return {
        finalGas: explicitGas,
        overridesWithGas: withGas(baseOverrides, explicitGas),
      };
    }

    if (mode === "strict") {
      return yield* simulateAndEstimateStrict(
        writer,
        params,
        baseOverrides,
        policy,
        options.onSimulating
      );
    }

    const estimateResult = yield* writer
      .estimateGas({
        ...params,
        overrides: baseOverrides,
      })
      .pipe(Effect.result);

    if (estimateResult._tag === "Failure") {
      if (isRecoverablePreflightError(estimateResult.failure)) {
        return {
          finalGas: explicitGas,
          overridesWithGas: withGas(baseOverrides, explicitGas),
          preflightWarning: toPreflightWarning(estimateResult.failure),
        };
      }

      return yield* Effect.fail(estimateResult.failure);
    }

    const derivedGas = applyGasLimitMultiplier(estimateResult.success, policy.gasLimitMultiplier);
    const finalGas = explicitGas ?? derivedGas;

    if (options.onSimulating) {
      yield* options.onSimulating();
    }

    const simulationResult = yield* writer
      .simulate({
        ...params,
        overrides: { ...baseOverrides, gas: finalGas },
      })
      .pipe(Effect.result);

    if (simulationResult._tag === "Failure") {
      if (isRecoverablePreflightError(simulationResult.failure)) {
        return {
          finalGas,
          overridesWithGas: { ...baseOverrides, gas: finalGas },
          preflightWarning: toPreflightWarning(simulationResult.failure),
        };
      }

      return yield* Effect.fail(simulationResult.failure);
    }

    return {
      finalGas,
      overridesWithGas: { ...baseOverrides, gas: finalGas },
    };
  });
