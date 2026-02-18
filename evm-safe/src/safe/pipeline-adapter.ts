import type {
  WriteAndTrackExecution,
  WriteAndTrackParams,
} from "@prb/effect-evm/contract/pipeline";
import { WriteExecutionAdapter } from "@prb/effect-evm/contract/pipeline";
import { TxFailedError } from "@prb/effect-evm/core/errors";
import type { TxState } from "@prb/effect-evm/tx";
import { initialTxState, TxManager } from "@prb/effect-evm/tx";
import type { ContractFunctionName } from "@prb/effect-evm/types";
import { Effect, Layer, Stream, SubscriptionRef } from "effect";
import type { Abi } from "viem";
import { encodeFunctionData } from "viem";
import { SafeAppsService } from "./service.js";
import type { SafeWriteAndTrackState } from "./write-and-track.js";
import { safeWriteAndTrack } from "./write-and-track.js";

function toFailedState(hash: string, message: string): TxState {
  return {
    error: new TxFailedError({
      hash,
      message,
    }),
    phase: "receipt",
    status: "failed",
  };
}

function mapSafeStateToTxState(state: SafeWriteAndTrackState): TxState {
  switch (state.status) {
    case "submitting":
      return { status: "signing" };
    case "awaiting_confirmations":
    case "awaiting_execution":
    case "pending":
    case "queued":
      return {
        confirmations: state.confirmations ?? 0,
        hash: state.safeTxHash,
        status: "pending",
      };
    case "success":
      return {
        hash: state.onchainHash,
        receipt: state.receipt,
        status: "mined",
      };
    case "cancelled":
      return toFailedState(state.safeTxHash, "Safe transaction was cancelled");
    case "failed":
      return toFailedState(state.safeTxHash ?? "unknown", state.error ?? "Safe transaction failed");
  }
}

function toTxFailedSafeError(error: unknown): TxFailedError {
  const hash =
    typeof error === "object" && error !== null && "safeTxHash" in error
      ? String((error as { safeTxHash: unknown }).safeTxHash)
      : "unknown";
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String((error as { message: unknown }).message)
      : "Safe multisig write failed";

  return new TxFailedError({
    cause: error,
    hash,
    message,
  });
}

export const SafeWriteExecutionAdapterLive = Layer.effect(
  WriteExecutionAdapter,
  Effect.gen(function* () {
    const safeApps = yield* SafeAppsService;
    const txManager = yield* TxManager;

    return WriteExecutionAdapter.of({
      canHandle: (params) =>
        safeApps.getInfo().pipe(
          Effect.map((info) => (params.chainId == null ? true : info.chainId === params.chainId)),
          Effect.catchAll(() => Effect.succeed(false))
        ),
      writeAndTrack: <
        TAbi extends Abi,
        TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
      >(
        params: WriteAndTrackParams<TAbi, TFunctionName>
      ) =>
        Effect.gen(function* () {
          const encodedData = yield* Effect.try({
            catch: (cause) =>
              new TxFailedError({
                cause,
                hash: "unknown",
                message: "Failed to encode Safe transaction calldata",
              }),
            try: () =>
              encodeFunctionData({
                abi: params.abi as Abi,
                args: params.args as readonly unknown[] | undefined,
                functionName: params.functionName as string,
              }),
          }).pipe(Effect.either);

          if (encodedData._tag === "Left") {
            const stateRef = yield* SubscriptionRef.make<TxState>(
              toFailedState("unknown", encodedData.left.message)
            );

            return {
              actions: {
                cancel: () => Effect.fail(encodedData.left),
                speedup: () => Effect.fail(encodedData.left),
              },
              result: Effect.fail(encodedData.left),
              stateRef,
            } satisfies WriteAndTrackExecution<TAbi>;
          }

          const safeTx = {
            data: encodedData.right,
            to: params.address,
            value: params.value ?? 0n,
          };

          const safeExecution = yield* safeWriteAndTrack({
            chainId: params.chainId,
            transactions: [safeTx],
          }).pipe(
            Effect.provideService(SafeAppsService, safeApps),
            Effect.provideService(TxManager, txManager)
          );

          const stateRef = yield* SubscriptionRef.make<TxState>(initialTxState);

          yield* Effect.forkScoped(
            Stream.runForEach(safeExecution.stateRef.changes, (safeState) =>
              SubscriptionRef.set(stateRef, mapSafeStateToTxState(safeState))
            )
          );

          const result = safeExecution.result.pipe(
            Effect.mapError(toTxFailedSafeError),
            Effect.flatMap((terminal) => {
              switch (terminal._tag) {
                case "success":
                  return Effect.succeed({
                    events: [],
                    hash: terminal.onchainHash,
                    receipt: terminal.receipt,
                  });
                case "queued":
                  return Effect.fail(
                    new TxFailedError({
                      hash: terminal.safeTxHash,
                      message: "Safe transaction is queued and awaiting more confirmations",
                    })
                  );
                case "cancelled":
                  return Effect.fail(
                    new TxFailedError({
                      hash: terminal.safeTxHash,
                      message: "Safe transaction was cancelled",
                    })
                  );
                case "failed":
                  return Effect.fail(
                    new TxFailedError({
                      hash: terminal.safeTxHash,
                      message: terminal.error,
                    })
                  );
                default:
                  return Effect.fail(
                    new TxFailedError({
                      hash: "unknown",
                      message: "Unexpected Safe terminal state",
                    })
                  );
              }
            })
          );

          return {
            actions: {
              cancel: () =>
                Effect.fail(
                  new TxFailedError({
                    hash: "unknown",
                    message: "Cancel is not supported for Safe multisig execution",
                  })
                ),
              speedup: () =>
                Effect.fail(
                  new TxFailedError({
                    hash: "unknown",
                    message: "Speedup is not supported for Safe multisig execution",
                  })
                ),
            },
            result,
            stateRef,
          } satisfies WriteAndTrackExecution<TAbi>;
        }),
    });
  })
);
