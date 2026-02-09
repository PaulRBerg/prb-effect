import { Context, Effect, Layer, Request, RequestResolver } from "effect";
import type { ContractReaderShape } from "#src/contract/index.js";
import { ContractReader } from "#src/contract/index.js";
import type { MulticallCall } from "#src/types/index.js";

export type MulticallBatchOptions = {
  readonly blockNumber?: bigint | undefined;
  readonly blockTag?: import("viem").BlockTag | undefined;
};

/**
 * Request type for multicall batching.
 * Each request represents a single contract call to be batched.
 */
interface MulticallRequest extends Request.Request<unknown, Error> {
  readonly _tag: "MulticallRequest";
  readonly chainId: number;
  readonly call: MulticallCall;
  readonly options?: MulticallBatchOptions | undefined;
}

const MulticallRequest = Request.tagged<MulticallRequest>("MulticallRequest");

/**
 * Generate a stable cache key for grouping requests by chainId and options.
 */
const stableStringify = (value: unknown): string =>
  JSON.stringify(value, (_, v) => (typeof v === "bigint" ? v.toString() : v));

const keyFor = (chainId: number, options?: MulticallBatchOptions | undefined): string =>
  `${chainId}:${stableStringify(options ?? {})}`;

type RequestGroup = {
  chainId: number;
  options?: MulticallBatchOptions | undefined;
  requests: readonly MulticallRequest[];
};

/**
 * Group requests by chainId and block options.
 */
const groupRequests = (requests: readonly MulticallRequest[]): Map<string, RequestGroup> => {
  const grouped = new Map<string, RequestGroup>();

  for (const req of requests) {
    const key = keyFor(req.chainId, req.options);
    const existing = grouped.get(key);
    if (existing) {
      grouped.set(key, {
        ...existing,
        requests: [...existing.requests, req],
      });
    } else {
      grouped.set(key, {
        chainId: req.chainId,
        options: req.options,
        requests: [req],
      });
    }
  }

  return grouped;
};

/**
 * Complete all requests in a group with a failure.
 */
const failGroup = (requests: readonly MulticallRequest[], error: Error) =>
  Effect.forEach(requests, (req) => Request.completeEffect(req, Effect.fail(error)), {
    discard: true,
  });

/**
 * Complete all requests in a group with their corresponding results.
 */
const completeGroup = (
  requests: readonly MulticallRequest[],
  results: readonly {
    status: "success" | "failure";
    result?: unknown;
    error?: Error;
  }[]
) =>
  Effect.forEach(
    requests,
    (req, i) => {
      const res = results[i];
      if (res?.status === "success") {
        return Request.completeEffect(req, Effect.succeed(res.result));
      }
      return Request.completeEffect(
        req,
        Effect.fail(res?.error ?? new Error("Unknown multicall error"))
      );
    },
    { discard: true }
  );

/**
 * Execute a single multicall group and complete all requests.
 */
const executeGroup = (contractReader: ContractReaderShape, group: RequestGroup) =>
  Effect.gen(function* () {
    const result = yield* contractReader
      .multicall(
        group.chainId,
        group.requests.map((r) => r.call),
        group.options
      )
      .pipe(Effect.either);

    if (result._tag === "Left") {
      const error = result.left instanceof Error ? result.left : new Error(String(result.left));
      yield* failGroup(group.requests, error);
    } else {
      yield* completeGroup(group.requests, result.right);
    }
  });

/**
 * Creates a batched RequestResolver that groups multicall requests by chainId and options.
 */
const makeMulticallResolver = (
  contractReader: ContractReaderShape
): RequestResolver.RequestResolver<MulticallRequest, never> =>
  RequestResolver.makeBatched((requests: readonly MulticallRequest[]) =>
    Effect.gen(function* () {
      const grouped = groupRequests(requests);

      // Execute groups in parallel (cross-chain requests can run concurrently)
      yield* Effect.all(
        [...grouped.values()].map((group) => executeGroup(contractReader, group)),
        { concurrency: "unbounded" }
      );
    })
  ).pipe(RequestResolver.batchN(100));

export type MulticallBatcherShape = {
  readonly enqueue: <A>(
    chainId: number,
    call: MulticallCall,
    options?: MulticallBatchOptions | undefined
  ) => Effect.Effect<A, Error>;
};

export class MulticallBatcher extends Context.Tag("ew3/MulticallBatcher")<
  MulticallBatcher,
  MulticallBatcherShape
>() {}

/**
 * Live implementation of MulticallBatcher using Effect's Request/RequestResolver.
 * Automatically batches and deduplicates multicall requests across concurrent fibers.
 */
export const MulticallBatcherLive = Layer.effect(
  MulticallBatcher,
  Effect.gen(function* () {
    const contractReader = yield* ContractReader;
    const resolver = makeMulticallResolver(contractReader);

    return MulticallBatcher.of({
      enqueue: <A>(chainId: number, call: MulticallCall, options?: MulticallBatchOptions) =>
        Effect.request(MulticallRequest({ call, chainId, options }), resolver) as Effect.Effect<
          A,
          Error
        >,
    });
  })
);
