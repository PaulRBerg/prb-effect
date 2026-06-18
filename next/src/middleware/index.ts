/**
 */
import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";
import type { Mutable } from "effect/Types";

/**
 * @category type ids
 */
export const TypeId: unique symbol = Symbol.for("effect-next/Middleware");

/**
 * @category type ids
 */
export type TypeId = typeof TypeId;

/**
 * @category models
 */
type MiddlewareOptions = {
  props: unknown;
};

/**
 * Standard middleware that returns a service and can fail.
 *
 * @category models
 */
export type NextMiddleware<Provides, E, R = never> = (
  options: MiddlewareOptions
) => Effect.Effect<Provides, E, R>;

/**
 * Wrapping middleware that intercepts the next effect in the chain.
 *
 * @category models
 */
export type NextMiddlewareWrap<Provides, Catches, R> = <A>(
  options: MiddlewareOptions & {
    readonly next: Effect.Effect<A, Catches, Provides>;
  }
) => Effect.Effect<A, never, R>;

/**
 * @category models
 */
export type TagClass<Self, Name extends string, Options, R> = TagClass.Base<
  Self,
  Name,
  Options,
  TagClass.Wrap<Options> extends true
    ? NextMiddlewareWrap<TagClass.Provides<Options>, TagClass.CatchesValue<Options>, R>
    : NextMiddleware<TagClass.Service<Options>, TagClass.FailureService<Options>, R>
> &
  (TagClass.Wrap<Options> extends true
    ? {
        /**
         * Helper to create a wrapping middleware implementation with proper types.
         * Eliminates the need for manual `as NextMiddlewareWrap<...>` casts.
         *
         * @remarks
         * This method is only available on middleware tags created with `{ wrap: true }`.
         *
         * @example
         * ```typescript
         * class MyMiddleware extends Tag<MyMiddleware>()("MyMiddleware", { wrap: true }) {}
         *
         * const MyMiddlewareLive = Layer.succeed(
         *   MyMiddleware,
         *   MyMiddleware.of(({ next }) =>
         *     Effect.gen(function* () {
         *       const result = yield* next;
         *       return result;
         *     })
         *   )
         * );
         * ```
         */
        of<A, Catches, R2>(
          impl: (
            ctx: MiddlewareOptions & { readonly next: Effect.Effect<A, Catches, unknown> }
          ) => Effect.Effect<A, never, R2>
        ): NextMiddlewareWrap<unknown, Catches, R2>;
      }
    : object);

/**
 * @category models
 */
export declare namespace TagClass {
  /**
   * @category models
   */
  export type Provides<Options> = Options extends {
    readonly provides: infer P;
  }
    ? P extends { Identifier: infer I }
      ? I
      : never
    : never;

  /**
   * @category models
   */
  export type Service<Options> = Options extends {
    readonly provides: infer P;
  }
    ? P extends { Service: infer S }
      ? S
      : never
    : undefined;

  /**
   * @category models
   */
  export type FailureSchema<Options> = Options extends {
    readonly failure: Schema.Schema.All;
  }
    ? Options["failure"]
    : typeof Schema.Never;

  /**
   * @category models
   */
  export type Failure<Options> = Options extends {
    readonly failure: Schema.Schema<infer _A, infer _I, infer _R>;
  }
    ? _A
    : never;

  /**
   * @category models
   */
  export type FailureContext<Options> = Schema.Schema.Context<FailureSchema<Options>>;

  /**
   * @category models
   */
  export type FailureService<Options> = Failure<Options>;

  /**
   * @category models
   */
  export type Wrap<Options> = Options extends { readonly wrap: true } ? true : false;

  /**
   * @category models
   */
  export type CatchesSchema<Options> =
    Wrap<Options> extends true
      ? Options extends { readonly catches: Schema.Schema.All }
        ? Options["catches"]
        : typeof Schema.Never
      : typeof Schema.Never;

  /**
   * @category models
   */
  export type CatchesValue<Options> =
    CatchesSchema<Options> extends Schema.Schema<infer A, infer _I, infer _R> ? A : never;

  /**
   * @category models
   */
  export type ReturnsSchema<Options> =
    Wrap<Options> extends true
      ? Options extends { readonly returns: Schema.Schema.All }
        ? Options["returns"]
        : typeof Schema.Never
      : typeof Schema.Never;

  /**
   * @category models
   */
  export interface Base<Self, Name extends string, Options, S> extends Context.Tag<Self, S> {
    readonly catches: CatchesSchema<Options>;
    readonly failure: FailureSchema<Options>;
    readonly provides: Options extends { readonly provides: infer P }
      ? P extends { Identifier: unknown }
        ? P
        : undefined
      : undefined;
    readonly returns: ReturnsSchema<Options>;
    readonly wrap: Wrap<Options>;
    new (_: never): Context.TagClassShape<Name, Service<Options>>;
    readonly [TypeId]: TypeId;
  }
}

/**
 * @category models
 */
export interface TagClassAny
  extends Context.Tag<
    unknown,
    | unknown
    | NextMiddleware<unknown, unknown, unknown>
    | NextMiddlewareWrap<unknown, unknown, unknown>
  > {
  readonly catches: Schema.Schema.All;
  readonly failure: Schema.Schema.All;
  readonly key: string;
  readonly provides?: { readonly Identifier: unknown } | undefined;
  readonly returns: Schema.Schema.All;
  readonly wrap: boolean;
  readonly [TypeId]: TypeId;
}

/**
 * @category models
 */
export interface TagClassAnyWithProps
  extends Context.Tag<
    unknown,
    NextMiddleware<unknown, unknown, unknown> | NextMiddlewareWrap<unknown, unknown, unknown>
  > {
  readonly catches: Schema.Schema.All;
  readonly failure: Schema.Schema.All;
  readonly key: string;
  readonly provides?: { readonly Identifier: unknown } | undefined;
  readonly returns: Schema.Schema.All;
  readonly wrap: boolean;
  readonly [TypeId]: TypeId;
}

/**
 * Creates a middleware tag that can be used with Next handlers.
 *
 * @category tags
 */
export const Tag =
  <Self>(): (<
    const Name extends string,
    const Options extends
      | {
          readonly wrap: true;
          readonly failure?: Schema.Schema.All;
          readonly provides?: {
            readonly Identifier: unknown;
            readonly Service: unknown;
          };
          readonly catches?: Schema.Schema.All;
          readonly returns?: Schema.Schema.All;
        }
      | {
          readonly wrap?: false;
          readonly failure?: Schema.Schema.All;
          readonly provides?: {
            readonly Identifier: unknown;
            readonly Service: unknown;
          };
          readonly catches?: undefined;
        },
  >(
    id: Name,
    options?: Options | undefined
  ) => TagClass<Self, Name, Options, never>) =>
  <
    Name extends string,
    Options extends {
      readonly wrap?: boolean;
      readonly failure?: Schema.Schema.All;
      readonly provides?: {
        readonly Identifier: unknown;
        readonly Service: unknown;
      };
      readonly catches?: Schema.Schema.All;
      readonly returns?: Schema.Schema.All;
    },
  >(
    id: Name,
    options?: Options | undefined
  ) => {
    type V8ErrorConstructor = ErrorConstructor & { stackTraceLimit?: number };
    const Err = globalThis.Error as V8ErrorConstructor;
    const limit = Err.stackTraceLimit;
    Err.stackTraceLimit = 2;
    const creationError = new Err();
    Err.stackTraceLimit = limit;

    function TagClassProto() {
      // noop
    }
    const TagClass_ = TagClassProto as unknown as Mutable<TagClassAny>;
    Object.setPrototypeOf(
      TagClassProto,
      Object.getPrototypeOf(Context.GenericTag<Self, unknown>(id))
    );
    TagClassProto.key = id;
    Object.defineProperty(TagClassProto, "stack", {
      get() {
        return creationError.stack;
      },
    });
    TagClass_[TypeId] = TypeId;
    TagClass_.failure = options?.failure === undefined ? Schema.Never : options.failure;
    TagClass_.catches =
      options?.wrap === true && options.catches !== undefined ? options.catches : Schema.Never;
    if (options?.provides) {
      TagClass_.provides = options.provides;
    }
    TagClass_.wrap = options?.wrap ?? false;
    TagClass_.returns =
      options?.wrap === true && options.returns !== undefined ? options.returns : Schema.Never;
    TagClass_.of = <A, Catches, R2>(
      impl: (
        ctx: MiddlewareOptions & { readonly next: Effect.Effect<A, Catches, unknown> }
      ) => Effect.Effect<A, never, R2>
    ): NextMiddlewareWrap<unknown, Catches, R2> => impl as NextMiddlewareWrap<unknown, Catches, R2>;
    return TagClassProto as unknown as TagClass<Self, Name, Options, never>;
  };
