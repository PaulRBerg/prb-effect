import { Effect, Layer } from "effect";
import { ContractWriter } from "#src/contract/index.js";
import { PublicClientService } from "#src/core/index.js";
import { EventStream } from "#src/events/index.js";
import { GasService } from "#src/gas/index.js";
import { NonceService } from "#src/nonce/index.js";
import { TxManager, TxReplacement } from "#src/tx/index.js";
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

    return ContractPipeline.of({
      writeAndTrack: makeWriteAndTrack(writeAndTrackDeps),
      writeAndWait: makeWriteAndWait(writeAndWaitDeps),
    });
  })
);
