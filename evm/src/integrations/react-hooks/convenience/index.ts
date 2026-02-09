"use client";

import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import { constVoid as noop } from "effect/Function";
import * as Scope from "effect/Scope";
import * as Stream from "effect/Stream";
import * as React from "react";
import type * as Abi_ from "viem";
import type {
  WriteAndTrackError,
  WriteAndTrackParams,
  WriteAndTrackResult,
} from "#src/contract/index.js";
import { ContractPipeline } from "#src/contract/index.js";
import { ContractQuery } from "#src/query/index.js";
import type { TxState } from "#src/tx/index.js";
import { initialTxState } from "#src/tx/index.js";
import type { ContractFunctionName, ReadParams } from "#src/types/index.js";

import { fromCause, fromUnknown } from "../internal/error.js";
import { makeScopedRun } from "../internal/scoped-run.js";
import { stableStringify } from "../internal/stable.js";
import type { StreamState, UseEffectResult } from "../primitives.js";
import { useEffectMemo, useStream, useStreamEffect } from "../primitives.js";
import { useEffectEvmRuntime } from "../provider.js";

export const useContractRead = <
  TAbi extends Abi_.Abi,
  TFn extends ContractFunctionName<TAbi, "pure" | "view">,
>(
  params: ReadParams<TAbi, TFn>,
  options: {
    readonly blockScoped?: boolean | undefined;
    readonly initial?: Abi_.ContractFunctionReturnType<TAbi, "pure" | "view", TFn> | undefined;
    readonly ttl?: number | undefined;
  } = {}
): UseEffectResult<Abi_.ContractFunctionReturnType<TAbi, "pure" | "view", TFn>, unknown> => {
  const deps = [
    stableStringify(params.chainId),
    stableStringify(params.address),
    stableStringify(params.functionName),
    stableStringify(params.args ?? []),
    stableStringify(params.abi),
    stableStringify(params.account),
    stableStringify(params.blockNumber),
    stableStringify(params.blockTag),
    stableStringify(options.blockScoped ?? true),
    stableStringify(options.ttl),
  ];

  return useEffectMemo(
    () =>
      Effect.gen(function* () {
        const cq = yield* ContractQuery;
        return yield* cq.read(params, {
          blockScoped: options.blockScoped,
          ttl: options.ttl,
        });
      }),
    deps,
    { initial: options.initial }
  );
};

export const useWatchContractRead = <
  TAbi extends Abi_.Abi,
  TFn extends ContractFunctionName<TAbi, "pure" | "view">,
>(
  params: ReadParams<TAbi, TFn>,
  options: {
    readonly blockScoped?: boolean | undefined;
    readonly initial?: Abi_.ContractFunctionReturnType<TAbi, "pure" | "view", TFn> | undefined;
    readonly refetchOn?: import("effect/Stream").Stream<unknown, never> | undefined;
    readonly ttl?: number | undefined;
  } = {}
): StreamState<Abi_.ContractFunctionReturnType<TAbi, "pure" | "view", TFn>> => {
  const deps = [
    stableStringify(params.chainId),
    stableStringify(params.address),
    stableStringify(params.functionName),
    stableStringify(params.args ?? []),
    stableStringify(params.abi),
    stableStringify(params.account),
    stableStringify(params.blockNumber),
    stableStringify(params.blockTag),
    stableStringify(options.blockScoped ?? true),
    stableStringify(options.ttl),
  ];

  return useStreamEffect(
    () =>
      Effect.gen(function* () {
        const cq = yield* ContractQuery;
        return yield* cq.watchRead(params, {
          blockScoped: options.blockScoped,
          refetchOn: options.refetchOn,
          ttl: options.ttl,
        });
      }),
    deps,
    { initial: options.initial }
  );
};

export type UseWriteAndTrackActions = {
  readonly cancel: () => void;
  readonly speedup: () => void;
};

export type UseWriteAndTrackResult<TAbi extends Abi_.Abi> = {
  readonly actions?: UseWriteAndTrackActions | undefined;
  readonly result: UseEffectResult<WriteAndTrackResult<TAbi>, WriteAndTrackError>;
  readonly send: () => void;
  readonly state: TxState;
};

export const useWriteAndTrack = <
  TAbi extends Abi_.Abi,
  TFn extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
>(
  params: WriteAndTrackParams<TAbi, TFn>
): UseWriteAndTrackResult<TAbi> => {
  const runtime = useEffectEvmRuntime();

  const closeRef = React.useRef<(() => void) | null>(null);
  const runIdRef = React.useRef(0);

  const [actions, setActions] = React.useState<UseWriteAndTrackActions>();
  const [result, setResult] = React.useState<
    UseEffectResult<WriteAndTrackResult<TAbi>, WriteAndTrackError>
  >({ status: "idle" });
  const [stateRef, setStateRef] = React.useState<
    import("effect/SubscriptionRef").SubscriptionRef<TxState> | null
  >(null);

  React.useEffect(
    () => () => {
      closeRef.current?.();
    },
    []
  );

  const send = React.useCallback(() => {
    runIdRef.current += 1;
    const runId = runIdRef.current;

    closeRef.current?.();
    closeRef.current = null;

    setResult({ status: "loading" });

    (async () => {
      const scoped = await makeScopedRun(runtime);
      closeRef.current = scoped.close;

      const start = Effect.gen(function* () {
        const pipeline = yield* ContractPipeline;
        return yield* pipeline.writeAndTrack(params);
      });

      const started = await runtime.runPromise(Scope.extend(scoped.scope)(start));
      if (runIdRef.current !== runId) {
        scoped.close();
        return;
      }

      setStateRef(started.stateRef);
      setActions({
        cancel: () => {
          runtime.runPromise(Scope.extend(scoped.scope)(started.actions.cancel())).catch(noop);
        },
        speedup: () => {
          runtime.runPromise(Scope.extend(scoped.scope)(started.actions.speedup())).catch(noop);
        },
      });

      const fiber = scoped.fork(Effect.exit(started.result));
      const exit = await runtime.runPromise(Fiber.join(fiber));

      if (runIdRef.current !== runId) {
        scoped.close();
        return;
      }

      if (exit._tag === "Success") {
        setResult({
          data: exit.value as WriteAndTrackResult<TAbi>,
          status: "success",
        });
      } else {
        setResult({
          error: fromCause(exit.cause),
          status: "error",
        });
      }
    })().catch((cause) => {
      setResult({
        error: fromUnknown(cause) as unknown as WriteAndTrackError,
        status: "error",
      });
    });
  }, [params, runtime]);

  const stateStream = React.useMemo(
    () => (stateRef ? stateRef.changes : Stream.succeed(initialTxState)),
    [stateRef]
  );
  const streamState = useStream(stateStream, { initial: initialTxState });
  const state = streamState.status === "running" ? streamState.value : initialTxState;

  return { actions, result, send, state };
};
