import type { Address, Lamports } from "@solana/kit";
import { Context, Duration, Effect, Layer, Schedule, Stream } from "effect";
import { RpcError } from "@/src/core/errors/index.js";
import { RpcService } from "@/src/rpc/index.js";
import { SpanNames } from "@/src/telemetry/index.js";

/**
 * Shape of the Balance service for type inference.
 *
 * @category Services
 */
export type BalanceServiceShape = {
  /**
   * Get the SOL balance for an address.
   */
  readonly getSolBalance: (address: Address) => Effect.Effect<Lamports, RpcError>;

  /**
   * Check if an address has sufficient SOL balance.
   */
  readonly hasSufficientBalance: (params: {
    address: Address;
    required: Lamports;
  }) => Effect.Effect<boolean, RpcError>;

  /**
   * Watch SOL balance changes for an address.
   */
  readonly watchBalance: (params: {
    address: Address;
    pollingInterval?: number;
  }) => Effect.Effect<Stream.Stream<Lamports, RpcError>>;
};

/**
 * Service tag for Balance operations.
 *
 * @category Services
 */
export class BalanceService extends Context.Tag("esolana/BalanceService")<
  BalanceService,
  BalanceServiceShape
>() {}

/**
 * Live implementation of the Balance service.
 *
 * @category Layers
 */
export const BalanceServiceLive = Layer.effect(
  BalanceService,
  Effect.gen(function* () {
    const rpcService = yield* RpcService;

    return BalanceService.of({
      getSolBalance: (address) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const rpcUrl = yield* rpcService.getRpcUrl();

          return yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to get balance for ${address}`,
                url: rpcUrl,
              }),
            try: () => rpc.getBalance(address).send(),
          });
        }).pipe(
          Effect.map((response) => response.value),
          Effect.withSpan(SpanNames.BALANCE_GET_SOL, {
            attributes: { address },
          })
        ),

      hasSufficientBalance: (params) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const rpcUrl = yield* rpcService.getRpcUrl();

          const response = yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to get balance for ${params.address}`,
                url: rpcUrl,
              }),
            try: () => rpc.getBalance(params.address).send(),
          });

          return response.value >= params.required;
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_GET_SOL, {
            attributes: {
              address: params.address,
              required: params.required.toString(),
            },
          })
        ),

      watchBalance: (params) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const rpcUrl = yield* rpcService.getRpcUrl();
          const interval = params.pollingInterval ?? 5000;

          return Stream.repeatEffectWithSchedule(
            Effect.tryPromise({
              catch: (cause) =>
                new RpcError({
                  cause,
                  message: `Failed to poll balance for ${params.address}`,
                  url: rpcUrl,
                }),
              try: () => rpc.getBalance(params.address).send(),
            }).pipe(Effect.map((response) => response.value)),
            Schedule.spaced(Duration.millis(interval))
          );
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_WATCH_SOL, {
            attributes: {
              address: params.address,
              pollingInterval: params.pollingInterval,
            },
          })
        ),
    });
  })
);
