import { Effect, Layer, Option } from "effect";
import { ContractWriter } from "#src/contract/index.js";
import { PublicClientService } from "#src/core/index.js";
import { EventStream } from "#src/events/index.js";
import { GasService } from "#src/gas/index.js";
import { NonceService } from "#src/nonce/index.js";
import { TxManager, TxReplacement } from "#src/tx/index.js";
import { WriteExecutionAdapter } from "./adapter.js";
import type { ContractPipelineShape } from "./service.js";
import { ContractPipeline } from "./service.js";
import { makeWriteAndTrack } from "./write-and-track.js";
import { makeWriteAndWait } from "./write-and-wait.js";

export const ContractPipelineLive = Layer.effect(
  ContractPipeline,
  Effect.gen(function* () {
    const writer = yield* ContractWriter;
    const txManager = yield* TxManager;
    const eventStream = yield* EventStream;
    const nonceService = yield* NonceService;
    const txReplacement = yield* TxReplacement;
    const publicClientService = yield* PublicClientService;
    const gasService = yield* GasService;
    const adapterOption = yield* Effect.serviceOption(WriteExecutionAdapter);

    const writeAndTrackDeps = {
      eventStream,
      gasService,
      nonceService,
      publicClientService,
      txManager,
      txReplacement,
      writer,
    };

    const writeAndWaitDeps = {
      eventStream,
      gasService,
      nonceService,
      txManager,
      writer,
    };

    const defaultWriteAndTrack = makeWriteAndTrack(writeAndTrackDeps);

    const writeAndTrack: ContractPipelineShape["writeAndTrack"] = (params) =>
      Effect.gen(function* () {
        if (Option.isNone(adapterOption)) {
          return yield* defaultWriteAndTrack(params);
        }

        const canHandle = yield* adapterOption.value.canHandle(params);
        return canHandle
          ? yield* adapterOption.value.writeAndTrack(params)
          : yield* defaultWriteAndTrack(params);
      });

    return ContractPipeline.of({
      writeAndTrack,
      writeAndWait: makeWriteAndWait(writeAndWaitDeps),
    });
  })
);
