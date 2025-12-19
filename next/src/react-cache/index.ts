/**
 * @since 1.0.0
 */
import "server-only";
import { Effect } from "effect";
import * as Context_ from "effect/Context";
import { revalidatePath, revalidateTag } from "next/cache.js";
import { ContextWrapperService } from "../internal/async-context.js";

/**
 * Revalidates cached data for a given path.
 *
 * **IMPORTANT:** This effect must be used within a Next.js handler context
 * (route handlers, server actions, or server components built with effect-next).
 * Using it outside this context will result in a runtime error.
 *
 * @param path - The path to revalidate
 * @param type - Optional type: "page" or "layout"
 * @since 1.0.0
 * @category cache
 * @example
 * ```ts
 * const handler = ServerAction.build(
 *   Effect.gen(function* () {
 *     yield* RevalidatePath("/blog", "page")
 *     // ...
 *   })
 * )
 * ```
 */
export const RevalidatePath = (
  ...args: Parameters<typeof revalidatePath>
): Effect.Effect<void, never, never> =>
  Effect.withSpan(
    Effect.flatMap(Effect.context<never>(), (context) => {
      const wrapWithContext = Context_.unsafeGet(context, ContextWrapperService);
      const wrappedFn = wrapWithContext(revalidatePath);
      return Effect.sync(() => wrappedFn(...args));
    }),
    "RevalidatePath"
  );

/**
 * Revalidates cached data associated with a specific tag.
 *
 * **IMPORTANT:** This effect must be used within a Next.js handler context
 * (route handlers, server actions, or server components built with effect-next).
 * Using it outside this context will result in a runtime error.
 *
 * @param tag - The cache tag to revalidate
 * @since 1.0.0
 * @category cache
 * @example
 * ```ts
 * const handler = ServerAction.build(
 *   Effect.gen(function* () {
 *     yield* RevalidateTag("posts")
 *     // ...
 *   })
 * )
 * ```
 */
export const RevalidateTag = (
  ...args: Parameters<typeof revalidateTag>
): Effect.Effect<void, never, never> =>
  Effect.withSpan(
    Effect.flatMap(Effect.context<never>(), (context) => {
      const wrapWithContext = Context_.unsafeGet(context, ContextWrapperService);
      const wrappedFn = wrapWithContext(revalidateTag);
      return Effect.sync(() => wrappedFn(...args));
    }),
    "RevalidateTag"
  );
