import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { Effect } from "effect";
import { RpcError } from "@/src/core/errors/rpc.js";
import type { RpcServiceShape } from "@/src/rpc/service.js";

/**
 * Get the RPC client and run an operation with it.
 *
 * Reduces boilerplate by combining client retrieval with Effect operations.
 *
 * @example
 * ```typescript
 * yield* withRpc(
 *   rpcService,
 *   (rpc) => Effect.tryPromise({
 *     try: () => rpc.getBalance(address).send(),
 *     catch: (e) => new RpcError({ cause: e, message: "Failed", url: "" })
 *   })
 * );
 * ```
 */
export const withRpc = <A, E, R>(
  rpcService: RpcServiceShape,
  fn: (rpc: Rpc<SolanaRpcApi>) => Effect.Effect<A, E, R>
): Effect.Effect<A, E, R> =>
  Effect.gen(function* () {
    const rpc = yield* rpcService.getRpc();
    return yield* fn(rpc);
  });

/**
 * Convert a Solana Kit Promise operation to an Effect with custom error classification.
 *
 * Reduces boilerplate when wrapping @solana/kit methods that return promises.
 *
 * @example
 * ```typescript
 * yield* kitTryPromise(
 *   () => rpc.getBalance(address).send(),
 *   (cause) => new RpcError({ cause, message: "Failed to get balance", url })
 * );
 * ```
 */
export const kitTryPromise = <A, E>(
  operation: () => Promise<A>,
  classifier: (error: unknown) => E
): Effect.Effect<A, E> =>
  Effect.tryPromise({
    catch: classifier,
    try: operation,
  });

/**
 * Classify Solana errors into appropriate error types.
 */
export const classifyRpcError = (
  error: unknown,
  context: { url: string; operation: string }
): RpcError => {
  const message = error instanceof Error ? error.message : String(error);
  return new RpcError({
    cause: error,
    message: `${context.operation} failed: ${message}`,
    url: context.url,
  });
};
