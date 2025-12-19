/**
 * @since 1.0.0
 */
import type * as Context from "effect/Context";
import type { Effect } from "effect/Effect";
import * as Effect_ from "effect/Effect";
import type * as NextMiddleware from "../middleware/index.js";

/**
 * Creates a recursive middleware chain that processes middleware tags in order.
 *
 * Middleware can either:
 * - Wrap the next effect (if tag.wrap is true)
 * - Provide a service to the next effect (if tag.provides is defined)
 * - Run before the next effect (default behavior)
 *
 * @since 1.0.0
 * @category utils
 */
export const createMiddlewareChain = <
  Tags extends readonly NextMiddleware.TagClassAnyWithProps[],
  A,
  E,
  R,
>(
  tags: Tags,
  resolve: (tag: Tags[number]) => unknown,
  base: Effect<A, E, R>,
  options: { props: unknown }
): Effect<A, E, R> => {
  const buildChain = (index: number): Effect<A, E, R> => {
    if (index >= tags.length) {
      return base;
    }
    const tag = tags[index];
    const middleware = resolve(tag);
    const tail = buildChain(index + 1);
    if (tag.wrap) {
      return (middleware as NextMiddleware.NextMiddlewareWrap<unknown, unknown, unknown>)({
        ...options,
        next: tail,
      }) as Effect<A, E, R>;
    }
    return tag.provides !== undefined
      ? (Effect_.provideServiceEffect(
          tail,
          tag.provides as unknown as Context.Tag<unknown, unknown>,
          (middleware as NextMiddleware.NextMiddleware<unknown, unknown, unknown>)(options)
        ) as Effect<A, E, R>)
      : (Effect_.zipRight(
          (middleware as NextMiddleware.NextMiddleware<unknown, unknown, unknown>)(options),
          tail
        ) as Effect<A, E, R>);
  };
  return buildChain(0);
};
