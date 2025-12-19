import "server-only";

/**
 * @since 1.0.0
 */
import { Effect } from "effect";
import * as Context_ from "effect/Context";
import { cookies, draftMode, headers } from "next/headers.js";
import { ContextWrapperService } from "../internal/async-context.js";

/**
 * Effect that provides access to Next.js cookies.
 *
 * **IMPORTANT:** This effect must be used within a Next.js handler context
 * (route handlers, server actions, or server components built with effect-next).
 * Using it outside this context will result in a runtime error.
 *
 * @since 1.0.0
 * @category request
 * @example
 * ```ts
 * const handler = BasePage.build(
 *   Effect.gen(function* () {
 *     const cookies = yield* Cookies
 *     const token = cookies.get("auth-token")
 *     // ...
 *   })
 * )
 * ```
 */
export const Cookies = Effect.fn("Cookies")(function* () {
  const context = yield* Effect.context<never>();
  const wrapWithContext = Context_.unsafeGet(context, ContextWrapperService);
  const wrappedFn = wrapWithContext(cookies);
  return yield* Effect.promise(() => wrappedFn());
});

/**
 * Effect that provides access to Next.js request headers.
 *
 * **IMPORTANT:** This effect must be used within a Next.js handler context
 * (route handlers, server actions, or server components built with effect-next).
 * Using it outside this context will result in a runtime error.
 *
 * @since 1.0.0
 * @category request
 * @example
 * ```ts
 * const handler = RouteHandler.build(
 *   Effect.gen(function* () {
 *     const headers = yield* Headers
 *     const auth = headers.get("authorization")
 *     // ...
 *   })
 * )
 * ```
 */
export const Headers = Effect.fn("Headers")(function* () {
  const context = yield* Effect.context<never>();
  const wrapWithContext = Context_.unsafeGet(context, ContextWrapperService);
  const wrappedFn = wrapWithContext(headers);
  return yield* Effect.promise(() => wrappedFn());
});

/**
 * Effect that provides access to Next.js draft mode helpers.
 *
 * **IMPORTANT:** This effect must be used within a Next.js handler context
 * (route handlers, server actions, or server components built with effect-next).
 * Using it outside this context will result in a runtime error.
 *
 * @since 1.0.0
 * @category request
 * @example
 * ```ts
 * const handler = ServerAction.build(
 *   Effect.gen(function* () {
 *     const draft = yield* DraftMode
 *     if (draft.isEnabled) {
 *       // ...
 *     }
 *   })
 * )
 * ```
 */
export const DraftMode = Effect.fn("DraftMode")(function* () {
  const context = yield* Effect.context<never>();
  const wrapWithContext = Context_.unsafeGet(context, ContextWrapperService);
  const wrappedFn = wrapWithContext(draftMode);
  return yield* Effect.promise(() => wrappedFn());
});
