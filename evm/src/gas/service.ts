import { Context, Effect, Layer } from "effect";
import type { Address, Hex } from "viem";
import type { ClientNotFoundError } from "#src/core/errors/index.js";
import { PublicClientService } from "#src/core/index.js";
import { GasPriceUnavailableError } from "#src/gas/errors.js";
import type { FeeEstimate, GasSpeed } from "#src/gas/estimator.js";
import {
  estimateL1FeeImpl,
  getAllFeeEstimatesImpl,
  hasL1DataFeeImpl,
  supportsEip1559Impl,
} from "#src/gas/estimator.js";
import { SpanNames } from "#src/telemetry/index.js";

export type GasServiceShape = {
  readonly estimateFees: (params: {
    chainId: number;
    speed?: GasSpeed;
  }) => Effect.Effect<FeeEstimate, GasPriceUnavailableError | ClientNotFoundError>;

  readonly getAllFeeEstimates: (params: {
    chainId: number;
  }) => Effect.Effect<
    Record<GasSpeed, FeeEstimate>,
    GasPriceUnavailableError | ClientNotFoundError
  >;

  readonly getBaseFee: (params: {
    chainId: number;
  }) => Effect.Effect<bigint, GasPriceUnavailableError | ClientNotFoundError>;

  readonly getMaxPriorityFee: (params: {
    chainId: number;
  }) => Effect.Effect<bigint, GasPriceUnavailableError | ClientNotFoundError>;

  readonly estimateGas: (params: {
    chainId: number;
    data?: Hex;
    from?: Address;
    to: Address;
    value?: bigint;
  }) => Effect.Effect<bigint, GasPriceUnavailableError | ClientNotFoundError>;

  readonly estimateL1Fee: (params: {
    chainId: number;
    data?: Hex;
    from?: Address;
    to: Address;
    value?: bigint;
  }) => Effect.Effect<bigint, GasPriceUnavailableError | ClientNotFoundError>;

  readonly hasL1DataFee: (params: {
    chainId: number;
  }) => Effect.Effect<boolean, ClientNotFoundError>;

  readonly supportsEip1559: (params: {
    chainId: number;
  }) => Effect.Effect<boolean, GasPriceUnavailableError | ClientNotFoundError>;
};

export class GasService extends Context.Service<GasService, GasServiceShape>()("ew3/GasService") {}

export const GasServiceLive = Layer.effect(
  GasService,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    return GasService.of({
      estimateFees: (params: { chainId: number; speed?: GasSpeed }) =>
        Effect.gen(function* () {
          const allEstimates = yield* getAllFeeEstimatesImpl(publicClientService, params.chainId);
          const speed = params.speed ?? "standard";
          return allEstimates[speed];
        }).pipe(
          Effect.withSpan(SpanNames.GAS_ESTIMATE_FEES, {
            attributes: {
              chainId: params.chainId,
              speed: params.speed ?? "standard",
            },
          })
        ),

      estimateGas: (params: {
        chainId: number;
        data?: Hex;
        from?: Address;
        to: Address;
        value?: bigint;
      }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          return yield* Effect.tryPromise({
            catch: (cause) =>
              new GasPriceUnavailableError({
                cause,
                chainId: params.chainId,
                message: `Failed to estimate gas: ${String(cause)}`,
              }),
            try: () =>
              client.estimateGas({
                ...(params.from ? { account: params.from } : {}),
                data: params.data,
                to: params.to,
                value: params.value,
              }),
          });
        }).pipe(
          Effect.withSpan(SpanNames.GAS_ESTIMATE_GAS, {
            attributes: {
              chainId: params.chainId,
              to: params.to,
            },
          })
        ),

      estimateL1Fee: (params: {
        chainId: number;
        data?: Hex;
        from?: Address;
        to: Address;
        value?: bigint;
      }) =>
        estimateL1FeeImpl(publicClientService, params.chainId, params).pipe(
          Effect.withSpan(SpanNames.GAS_ESTIMATE_L1_FEE, {
            attributes: {
              chainId: params.chainId,
              to: params.to,
            },
          })
        ),

      getAllFeeEstimates: (params: { chainId: number }) =>
        Effect.gen(function* () {
          return yield* getAllFeeEstimatesImpl(publicClientService, params.chainId);
        }).pipe(
          Effect.withSpan(SpanNames.GAS_GET_ALL_ESTIMATES, {
            attributes: {
              chainId: params.chainId,
            },
          })
        ),

      getBaseFee: (params: { chainId: number }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          const block = yield* Effect.tryPromise({
            catch: (cause) =>
              new GasPriceUnavailableError({
                cause,
                chainId: params.chainId,
                message: `Failed to get base fee: ${String(cause)}`,
              }),
            try: () => client.getBlock({ blockTag: "pending" }),
          });

          let baseFee = block.baseFeePerGas;
          if (baseFee === null || baseFee === undefined) {
            const latestBlock = yield* Effect.tryPromise({
              catch: (cause) =>
                new GasPriceUnavailableError({
                  cause,
                  chainId: params.chainId,
                  message: `Failed to get latest block: ${String(cause)}`,
                }),
              try: () => client.getBlock({ blockTag: "latest" }),
            });
            baseFee = latestBlock.baseFeePerGas;
          }

          if (baseFee === null || baseFee === undefined) {
            return yield* Effect.fail(
              new GasPriceUnavailableError({
                chainId: params.chainId,
                message: "Base fee not available (chain may not support EIP-1559)",
              })
            );
          }

          return baseFee;
        }).pipe(
          Effect.withSpan(SpanNames.GAS_GET_BASE_FEE, {
            attributes: {
              chainId: params.chainId,
            },
          })
        ),

      getMaxPriorityFee: (params: { chainId: number }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(params.chainId);
          return yield* Effect.tryPromise({
            catch: (cause) =>
              new GasPriceUnavailableError({
                cause,
                chainId: params.chainId,
                message: `Failed to get max priority fee: ${String(cause)}`,
              }),
            try: () => client.estimateMaxPriorityFeePerGas(),
          });
        }).pipe(
          Effect.withSpan(SpanNames.GAS_GET_MAX_PRIORITY_FEE, {
            attributes: {
              chainId: params.chainId,
            },
          })
        ),

      hasL1DataFee: (params: { chainId: number }) =>
        hasL1DataFeeImpl(publicClientService, params.chainId).pipe(
          Effect.withSpan(SpanNames.GAS_HAS_L1_DATA_FEE, {
            attributes: {
              chainId: params.chainId,
            },
          })
        ),

      supportsEip1559: (params: { chainId: number }) =>
        Effect.gen(function* () {
          return yield* supportsEip1559Impl(publicClientService, params.chainId);
        }).pipe(
          Effect.withSpan(SpanNames.GAS_SUPPORTS_EIP1559, {
            attributes: {
              chainId: params.chainId,
            },
          })
        ),
    });
  })
);
