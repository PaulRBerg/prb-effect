import type { Effect, Scope } from "effect";
import { Context } from "effect";
import type { Abi } from "viem";
import type { ContractFunctionName } from "#src/types/index.js";
import type { WriteAndTrackExecution, WriteAndTrackParams } from "./types.js";

export type WriteExecutionAdapterShape = {
  readonly canHandle: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    params: WriteAndTrackParams<TAbi, TFunctionName>
  ) => Effect.Effect<boolean>;
  readonly writeAndTrack: <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(
    params: WriteAndTrackParams<TAbi, TFunctionName>
  ) => Effect.Effect<WriteAndTrackExecution<TAbi>, never, Scope.Scope>;
};

export class WriteExecutionAdapter extends Context.Service<
  WriteExecutionAdapter,
  WriteExecutionAdapterShape
>()("ew3/WriteExecutionAdapter") {}
