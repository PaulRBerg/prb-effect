import { Effect, Stream } from "effect";

/**
 * Configuration for creating a Stream from a watch callback
 */
export type WatchConfig<T, E> = {
  /** Function that sets up the watch and returns an unsubscribe function */
  readonly watch: (callbacks: {
    readonly onData: (data: T) => void;
    readonly onError: (error: unknown) => void;
  }) => () => void;
  /** Map unknown errors to typed errors */
  readonly mapError: (error: unknown) => E;
};

/**
 * Create a Stream from a viem-style watch callback.
 * Handles setup, cleanup, and error mapping.
 *
 * @example
 * ```ts
 * fromWatchCallback({
 *   watch: (cb) => client.watchBlocks({
 *     onBlock: cb.onData,
 *     onError: cb.onError,
 *   }),
 *   mapError: (e) => new BlockWatchError({ cause: e })
 * })
 * ```
 */
export const fromWatchCallback = <T, E>(config: WatchConfig<T, E>): Stream.Stream<T, E> =>
  Stream.async<T, E>((emit) => {
    const unwatch = config.watch({
      onData: (data) => emit.single(data),
      onError: (error) => emit.fail(config.mapError(error)),
    });
    return Effect.sync(() => unwatch());
  });
