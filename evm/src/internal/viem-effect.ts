import { Effect } from "effect";
import type { PublicClient, WalletClient } from "viem";
import type {
  PublicClientServiceShape,
  WalletClientServiceShape,
} from "@/src/core/clients/index.js";
import type {
  ClientNotFoundError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "@/src/core/errors/index.js";

/**
 * Get a public client for the specified chain and run an operation with it.
 *
 * Reduces boilerplate by combining client retrieval with Effect operations.
 *
 * @example
 * ```typescript
 * yield* withPublicClient(
 *   publicClientService,
 *   chainId,
 *   (client) => Effect.tryPromise({
 *     try: () => client.getBlockNumber(),
 *     catch: (e) => new SomeError({ cause: e })
 *   })
 * );
 * ```
 */
export const withPublicClient = <A, E, R>(
  publicClientService: PublicClientServiceShape,
  chainId: number,
  fn: (client: PublicClient) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | ClientNotFoundError, R> =>
  Effect.gen(function* () {
    const client = yield* publicClientService.get(chainId);
    return yield* fn(client);
  });

/**
 * Get a wallet client for the specified chain and run an operation with it.
 *
 * Reduces boilerplate by combining client retrieval with Effect operations.
 *
 * @example
 * ```typescript
 * yield* withWalletClient(
 *   walletClientService,
 *   chainId,
 *   (client) => Effect.tryPromise({
 *     try: () => client.sendTransaction(request),
 *     catch: (e) => new TransactionError({ cause: e })
 *   })
 * );
 * ```
 */
export const withWalletClient = <A, E, R>(
  walletClientService: WalletClientServiceShape,
  chainId: number,
  fn: (client: WalletClient) => Effect.Effect<A, E, R>
): Effect.Effect<A, E | WalletNotConnectedError | WrongNetworkError, R> =>
  Effect.gen(function* () {
    const client = yield* walletClientService.get(chainId);
    return yield* fn(client);
  });

/**
 * Convert a viem Promise operation to an Effect with custom error classification.
 *
 * Reduces boilerplate when wrapping viem client methods that return promises.
 *
 * @example
 * ```typescript
 * yield* viemTryPromise(
 *   () => client.readContract({ ... }),
 *   (cause) => classifyContractError(cause, { address, functionName })
 * );
 * ```
 */
export const viemTryPromise = <A, E>(
  operation: () => Promise<A>,
  classifier: (error: unknown) => E
): Effect.Effect<A, E> =>
  Effect.tryPromise({
    catch: classifier,
    try: operation,
  });
