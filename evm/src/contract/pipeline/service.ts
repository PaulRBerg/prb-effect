import type { Effect, Scope, SubscriptionRef } from "effect";
import { Context } from "effect";
import type { Abi, Hash } from "viem";
import type {
  ClientNotFoundError,
  TxFailedError,
  WalletNotConnectedError,
} from "#src/core/index.js";
import type { GasPriceUnavailableError } from "#src/gas/index.js";
import type { TxPolicy, TxState } from "#src/tx/index.js";
import type { ContractFunctionName } from "#src/types/index.js";
import type { WriteAndTrackError, WriteAndTrackParams, WriteAndTrackResult } from "./types.js";

export type ContractPipelineShape = {
  /**
   * Full write pipeline: simulate -> estimate -> write -> track -> decode events
   * Returns reactive state ref for UI updates
   */
  readonly writeAndTrack: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    params: WriteAndTrackParams<TAbi, TFunctionName>
  ) => Effect.Effect<
    {
      stateRef: SubscriptionRef.SubscriptionRef<TxState>;
      actions: {
        readonly speedup: (
          policy?: TxPolicy
        ) => Effect.Effect<
          Hash,
          | TxFailedError
          | WalletNotConnectedError
          | ClientNotFoundError
          | GasPriceUnavailableError
          | Error
        >;
        readonly cancel: (
          policy?: TxPolicy
        ) => Effect.Effect<
          Hash,
          | TxFailedError
          | WalletNotConnectedError
          | ClientNotFoundError
          | GasPriceUnavailableError
          | Error
        >;
      };
      result: Effect.Effect<WriteAndTrackResult<TAbi>, WriteAndTrackError>;
    },
    never,
    Scope.Scope
  >;

  /**
   * Simplified version that just waits for receipt
   * No reactive state, just returns final result
   */
  readonly writeAndWait: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    params: WriteAndTrackParams<TAbi, TFunctionName>
  ) => Effect.Effect<WriteAndTrackResult<TAbi>, WriteAndTrackError>;
};

export class ContractPipeline extends Context.Tag("ew3/ContractPipeline")<
  ContractPipeline,
  ContractPipelineShape
>() {}
