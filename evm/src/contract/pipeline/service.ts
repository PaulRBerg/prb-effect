import type { Effect, Scope } from "effect";
import { Context } from "effect";
import type { Abi } from "viem";
import type { ContractFunctionName } from "#src/types/index.js";
import type {
  WriteAndTrackError,
  WriteAndTrackExecution,
  WriteAndTrackParams,
  WriteAndTrackResult,
} from "./types.js";

export type ContractPipelineShape = {
  /**
   * Full write pipeline: preflight -> write -> track -> decode events
   * Returns reactive state ref for UI updates
   */
  readonly writeAndTrack: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    params: WriteAndTrackParams<TAbi, TFunctionName>
  ) => Effect.Effect<WriteAndTrackExecution<TAbi>, never, Scope.Scope>;

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
