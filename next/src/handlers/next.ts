/**
 * Next.js route handler and server action builder with Effect-TS integration.
 *
 * Provides the `Next` type and factory functions (`make`, `makeWithRuntime`) for creating
 * type-safe handlers that:
 * - Run Effect programs with automatic context propagation
 * - Support composable middleware via tags
 * - Integrate with Next.js AsyncLocalStorage for request-scoped services
 *
 * @module
 * @since 1.0.0
 */
import { Effect, Option } from "effect";
import * as Context_ from "effect/Context";
import * as Layer from "effect/Layer";
import * as ManagedRuntime from "effect/ManagedRuntime";
import type { Pipeable } from "effect/Pipeable";
import { pipeArguments } from "effect/Pipeable";
import type * as Schema from "effect/Schema";
import { executeWithRuntime } from "../internal/executor.js";
import { createMiddlewareChain } from "../internal/middleware-chain.js";
import type * as NextMiddleware from "../middleware/index.js";
import type { NotFoundError, RedirectError } from "../navigation/index.js";

/**
 * @since 1.0.0
 * @category constants
 */
const NextSymbolKey = "effect-next/Next";

/**
 * @since 1.0.0
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for(NextSymbolKey);

/**
 * @since 1.0.0
 * @category type ids
 */
export type TypeId = typeof TypeId;

interface Any extends Pipeable {
  readonly [TypeId]: TypeId;
  readonly _tag: string;
  readonly key: string;
}

type AnyWithProps = {
  readonly [TypeId]: TypeId;
  readonly _tag: string;
  readonly key: string;
  readonly middlewares: readonly NextMiddleware.TagClassAnyWithProps[];
  readonly runtime?: ManagedRuntime.ManagedRuntime<unknown, unknown>;
};

/**
 * Extracts the provided environment from a `Layer`.
 */
type LayerSuccess<L> = L extends Layer.Layer.Any
  ? Layer.Layer.Success<L>
  : L extends RuntimeLayer<infer R>
    ? R
    : never;

/**
 * Phantom type to track runtime-provided environment.
 */
type RuntimeLayer<R> = { readonly _tag: "RuntimeLayer"; readonly _R: R };

/**
 * @since 1.0.0
 * @category models
 */
export interface Next<
  in out Tag extends string,
  out L extends Layer.Layer.Any | RuntimeLayer<unknown> | undefined,
  out Middleware extends NextMiddleware.TagClassAny = never,
> extends Pipeable {
  new (_: never): object;

  readonly [TypeId]: TypeId;
  readonly _tag: Tag;
  readonly key: string;
  readonly middlewares: readonly Middleware[];
  readonly runtime?: L extends Layer.Layer.Any
    ? ManagedRuntime.ManagedRuntime<Layer.Layer.Success<L>, Layer.Layer.Error<L>>
    : ManagedRuntime.ManagedRuntime<unknown, unknown>;
  readonly paramsSchema?: Schema.Schema.Any;
  readonly searchParamsSchema?: Schema.Schema.Any;

  /**
   * Adds a middleware tag to this handler. The middleware must be satisfied by
   * the environment provided by `L`.
   *
   * Note: The type constraint was relaxed to support generic function patterns.
   * If the middleware is not provided by the Layer, the handler will fail at
   * runtime with a context resolution error.
   */
  middleware<M>(
    middleware: M
  ): Next<Tag, L, Middleware | (M extends NextMiddleware.TagClassAny ? M : never)>;

  /**
   * Finalizes the handler by supplying an Effect-based implementation and
   * returns an async function compatible with Next.js.
   */
  build<A extends readonly unknown[], O>(
    handler: BuildHandler<Next<Tag, L, Middleware>, A, O>
  ): (
    ...args: A
  ) => Promise<
    ReturnType<BuildHandler<Next<Tag, L, Middleware>, A, O>> extends Effect.Effect<
      infer _A,
      infer _E,
      infer _R
    >
      ? _A | WrappedReturns<Middleware>
      : never
  >;
}

const Proto = {
  [TypeId]: TypeId,
  build<A extends readonly unknown[], O>(
    this: AnyWithProps,
    handler: (...args: A) => Effect.Effect<O, unknown, unknown>
  ) {
    const runtime = this.runtime;
    return (...args: A) => {
      const middlewares = this.middlewares;

      const program = Effect.gen(function* () {
        const context = yield* Effect.context<never>();

        let handlerEffect = handler(...args);

        if (middlewares.length > 0) {
          const tags = middlewares;
          handlerEffect = createMiddlewareChain(
            tags,
            (tag) => Context_.unsafeGet(context, tag),
            handlerEffect,
            { props: args }
          );
        }
        return yield* handlerEffect;
      });
      if (runtime) {
        return executeWithRuntime(
          runtime,
          program as unknown as Effect.Effect<unknown, unknown, never>
        );
      }
      return executeWithRuntime(
        undefined,
        program as unknown as Effect.Effect<unknown, unknown, never>
      );
    };
  },
  middleware(this: AnyWithProps, middleware: NextMiddleware.TagClassAny) {
    // While compile-time checks were relaxed for generic function compatibility,
    // runtime will fail with a clear error if middleware isn't in the Layer's context.
    // This occurs via Context_.unsafeGet in the middleware chain execution (line 135).
    if (this.runtime) {
      return makeProto({
        _tag: this._tag,
        middlewares: [...this.middlewares, middleware] as readonly NextMiddleware.TagClassAny[],
        runtime: this.runtime,
      });
    }
    return makeProto({
      _tag: this._tag,
      middlewares: [...this.middlewares, middleware] as readonly NextMiddleware.TagClassAny[],
    });
  },
  pipe(...args: unknown[]) {
    return pipeArguments(this, args as unknown as IArguments);
  },
};

const makeProto = <
  const Tag extends string,
  const L extends Layer.Layer.Any | RuntimeLayer<unknown> | undefined,
  Middleware extends NextMiddleware.TagClassAny,
>(options: {
  readonly _tag: Tag;
  readonly runtime?: ManagedRuntime.ManagedRuntime<unknown, unknown>;
  readonly middlewares: readonly NextMiddleware.TagClassAny[];
  readonly paramsSchema?: Schema.Schema.Any;
  readonly searchParamsSchema?: Schema.Schema.Any;
}): Next<Tag, L, Middleware> => {
  function NextProto() {
    // noop
  }
  Object.setPrototypeOf(NextProto, Proto);
  Object.assign(NextProto, options);
  NextProto.key = `${NextSymbolKey}/${options._tag}`;
  return NextProto as unknown as Next<Tag, L, Middleware>;
};

/**
 * Creates a new Next handler from a Layer.
 *
 * The handler automatically creates a ManagedRuntime from the layer and uses it
 * to execute Effect programs.
 *
 * Note: Unhandled error logging is suppressed to avoid cluttering the console with
 * Next.js control-flow exceptions (redirect, notFound, 401/403/404 errors). These are
 * not real errors - they're how Next.js implements control flow. All other errors will
 * still be logged through your application's error handling.
 *
 * @since 1.0.0
 * @category constructors
 */
export function make<const Tag extends string, const R, const E>(
  tag: Tag,
  layer: Layer.Layer<R, E, never>
): Next<Tag, Layer.Layer<R, E, never>> {
  const runtime = ManagedRuntime.make(
    Layer.mergeAll(layer, Layer.setUnhandledErrorLogLevel(Option.none()))
  );

  return makeProto({
    _tag: tag,
    middlewares: [] as never[],
    runtime: runtime as unknown as ManagedRuntime.ManagedRuntime<unknown, unknown>,
  });
}

/**
 * Creates a new Next handler from an existing ManagedRuntime.
 *
 * Use this when you want manual control over the runtime lifecycle.
 *
 * @since 1.0.0
 * @category constructors
 */
export function makeWithRuntime<const Tag extends string, R, E>(
  tag: Tag,
  runtime: ManagedRuntime.ManagedRuntime<R, E>
): Next<Tag, RuntimeLayer<R>> {
  return makeProto({
    _tag: tag,
    middlewares: [] as never[],
    runtime: runtime as unknown as ManagedRuntime.ManagedRuntime<unknown, unknown>,
  });
}

/**
 * Computes the environment required by a `Next` handler: the environment
 * provided by its `Layer` plus any environments declared by middleware tags.
 */
type ExtractProvides<R extends Any> =
  R extends Next<infer _Tag, infer _Layer, infer _Middleware>
    ? LayerSuccess<_Layer> | Context_.Tag.Identifier<_Middleware>
    : never;

/**
 * Navigation errors (NotFoundError, RedirectError) that are automatically
 * handled by the executor and converted to Next.js navigation calls.
 */
type NavigationError = NotFoundError | RedirectError;

/**
 * Signature of the effectful handler accepted by `build`.
 * Navigation errors are always allowed since they're caught by the executor.
 */
type BuildHandler<P extends Any, A extends readonly unknown[], O> = P extends Next<
  infer _Tag,
  infer _Layer,
  infer _Middleware
>
  ? (
      ...args: A
    ) => Effect.Effect<O, CatchesFromMiddleware<_Middleware> | NavigationError, ExtractProvides<P>>
  : never;

/**
 * Computes the wrapped return type produced by middleware implementing the
 * `wrap` protocol. When no wrapper is present, yields `never`.
 */
type WrappedReturns<M> = M extends { readonly wrap: true }
  ? Schema.Schema.Type<M extends { readonly returns: infer S } ? S : typeof Schema.Never>
  : never;

/** Extracts the union of error types that middleware can catch. */
type CatchesFromMiddleware<M> = M extends {
  readonly catches: Schema.Schema<infer A, infer _I, infer _R>;
}
  ? A
  : never;
