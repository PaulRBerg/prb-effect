import type { Effect, Scope } from "effect";
import { Context } from "effect";
import type { Abi } from "viem";
import type { ContractFunctionName } from "#src/types/index.js";
import type {
  WriteAndTrackError,
  WriteAndTrackExecution,
  WriteAndTrackParams,
  WriteAndTrackTerminal,
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
   * Simplified version that waits for terminal pipeline outcome.
   * No reactive state; returns terminal union (`success` | `queued` | `cancelled`).
   */
  readonly writeAndWait: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    params: WriteAndTrackParams<TAbi, TFunctionName>
  ) => Effect.Effect<WriteAndTrackTerminal<TAbi>, WriteAndTrackError>;
};

export class ContractPipeline extends Context.Service<ContractPipeline, ContractPipelineShape>()(
  "ew3/ContractPipeline"
) {}
