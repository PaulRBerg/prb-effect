import { Effect } from "effect";
import type { Abi } from "viem";
import { defaultPolicy } from "#src/tx/index.js";
import type { ContractFunctionName } from "#src/types/index.js";
import type { CorePipelineDeps } from "./internal/core.js";
import { runCorePipeline } from "./internal/core.js";
import type { WriteAndTrackParams } from "./types.js";

/**
 * Create the writeAndWait implementation
 */
export const makeWriteAndWait = (deps: CorePipelineDeps) =>
  Effect.fn("ContractPipeline.writeAndWait")(function* <
    TAbi extends Abi,
    TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
  >(params: WriteAndTrackParams<TAbi, TFunctionName>) {
    return yield* Effect.scoped(runCorePipeline(deps, params, params.policy ?? defaultPolicy));
  });
