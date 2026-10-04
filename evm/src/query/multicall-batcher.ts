import { Context, Effect, Layer, Request, RequestResolver } from "effect";
import type { Address } from "viem";
import type { ContractReaderShape } from "#src/contract/index.js";
import { ContractReader } from "#src/contract/index.js";
import type { MulticallCall } from "#src/types/index.js";

export type MulticallBatchOptions = {
  /** Account-sensitive reads bypass multicall to preserve msg.sender. */
  readonly account?: Address | undefined;
  readonly blockNumber?: bigint | undefined;
  readonly blockTag?: import("viem").BlockTag | undefined;
};

/**
 * Request type for multicall batching.
 * Each request represents a single contract call to be batched.
 */
interface MulticallRequest extends Request.Request<unknown, Error> {
  readonly _tag: "MulticallRequest";
  readonly call: MulticallCall;
  readonly chainId: number;
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
  requests: readonly Request.Entry<MulticallRequest>[];
};

/**
 * Group requests by chainId and block options.
 */
const groupRequests = (
  requests: readonly Request.Entry<MulticallRequest>[]
): Map<string, RequestGroup> => {
  const grouped = new Map<string, RequestGroup>();

  for (const req of requests) {
    const key = keyFor(req.request.chainId, req.request.options);
    const existing = grouped.get(key);
    if (existing) {
      grouped.set(key, {
        ...existing,
        requests: [...existing.requests, req],
      });
    } else {
      grouped.set(key, {
        chainId: req.request.chainId,
        options: req.request.options,
        requests: [req],
      });
    }
  }

  return grouped;
};

/**
 * Complete all requests in a group with a failure.
 */
const failGroup = (requests: readonly Request.Entry<MulticallRequest>[], error: Error) =>
  Effect.forEach(requests, (req) => Request.completeEffect(req, Effect.fail(error)), {
    discard: true,
  });

/**
 * Complete all requests in a group with their corresponding results.
 */
const completeGroup = (
  requests: readonly Request.Entry<MulticallRequest>[],
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
    if (group.options?.account !== undefined) {
      yield* Effect.forEach(
        group.requests,
        (request) =>
          Request.completeEffect(
            request,
            contractReader.read({
              ...request.request.call,
              account: group.options?.account,
              chainId: group.chainId,
              ...(group.options?.blockNumber === undefined
                ? { blockTag: group.options?.blockTag }
                : { blockNumber: group.options.blockNumber }),
            })
          ),
        { concurrency: 10, discard: true }
      );
      return;
    }

    const result = yield* contractReader
      .multicall(
        group.chainId,
        group.requests.map((r) => r.request.call),
        group.options
      )
      .pipe(Effect.result);

    if (result._tag === "Failure") {
      const error =
        result.failure instanceof Error ? result.failure : new Error(String(result.failure));
      yield* failGroup(group.requests, error);
    } else {
      yield* completeGroup(group.requests, result.success);
    }
  });

/**
 * Creates a batched RequestResolver that groups multicall requests by chainId and options.
 */
const makeMulticallResolver = (
  contractReader: ContractReaderShape
): RequestResolver.RequestResolver<MulticallRequest> =>
  RequestResolver.make((requests: readonly Request.Entry<MulticallRequest>[]) =>
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

export class MulticallBatcher extends Context.Service<MulticallBatcher, MulticallBatcherShape>()(
  "ew3/MulticallBatcher"
) {}

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
