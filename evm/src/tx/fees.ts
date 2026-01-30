import { Effect } from "effect";
import type { ClientNotFoundError } from "@/src/core/index.js";
import type { GasPriceUnavailableError } from "@/src/gas/index.js";
import { GasService } from "@/src/gas/index.js";
import type { FeeOverrides, TxOverrides } from "@/src/types/index.js";
import type { TxPolicy } from "./policy.js";

const cap = (value: bigint, max: bigint | undefined): bigint =>
  max !== undefined && value > max ? max : value;

const hasLegacyFeeOverride = (
  overrides: TxOverrides | undefined
): overrides is TxOverrides & {
  gasPrice: bigint;
} => overrides?.gasPrice !== undefined;

const hasEip1559FeeOverride = (
  overrides: TxOverrides | undefined
): overrides is TxOverrides & {
  maxFeePerGas: bigint;
} => overrides?.maxFeePerGas !== undefined;

export const deriveTxType = (params: {
  chainId: number;
  policy?: TxPolicy | undefined;
  userOverrides?: TxOverrides | undefined;
}): Effect.Effect<
  TxOverrides["type"],
  GasPriceUnavailableError | ClientNotFoundError,
  GasService
> =>
  Effect.gen(function* () {
    const userOverrides = params.userOverrides;

    if (userOverrides?.type) {
      return userOverrides.type;
    }

    if (params.policy?.txType) {
      return params.policy.txType;
    }

    if (userOverrides?.gasPrice !== undefined) {
      return "legacy";
    }

    const gasService = yield* GasService;
    const supportsEip1559 = yield* gasService.supportsEip1559({
      chainId: params.chainId,
    });
    return supportsEip1559 ? "eip1559" : "legacy";
  });

export const deriveFeeOverrides = (params: {
  chainId: number;
  policy?: TxPolicy | undefined;
  userOverrides?: TxOverrides | undefined;
}): Effect.Effect<FeeOverrides, GasPriceUnavailableError | ClientNotFoundError, GasService> =>
  Effect.gen(function* () {
    const policy = params.policy;
    const userOverrides = params.userOverrides;

    if (hasLegacyFeeOverride(userOverrides)) {
      return { gasPrice: userOverrides.gasPrice };
    }

    if (hasEip1559FeeOverride(userOverrides)) {
      return {
        maxFeePerGas: userOverrides.maxFeePerGas,
        maxPriorityFeePerGas: userOverrides.maxPriorityFeePerGas,
      };
    }

    const gasService = yield* GasService;
    const supportsEip1559 = yield* gasService.supportsEip1559({
      chainId: params.chainId,
    });
    const estimate = yield* gasService.estimateFees({
      chainId: params.chainId,
      speed: policy?.feeSpeed,
    });

    if (!supportsEip1559) {
      const gasPrice = cap(estimate.gasPrice ?? estimate.maxFeePerGas, policy?.maxFeePerGas);
      return { gasPrice };
    }

    const maxFeePerGas = cap(estimate.maxFeePerGas, policy?.maxFeePerGas);
    const computedMaxPriorityFeePerGas = cap(
      estimate.maxPriorityFeePerGas,
      policy?.maxPriorityFeePerGas
    );

    const maxPriorityFeePerGas =
      userOverrides?.maxPriorityFeePerGas ?? computedMaxPriorityFeePerGas;

    return { maxFeePerGas, maxPriorityFeePerGas };
  });
