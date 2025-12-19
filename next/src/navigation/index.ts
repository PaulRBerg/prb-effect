/**
 * @since 1.0.0
 */
import "server-only";
import { Data, Effect } from "effect";

/**
 * Error representing a redirect navigation.
 * @since 1.0.0
 */
export class RedirectError extends Data.TaggedError("RedirectError")<{
  readonly url: string;
  readonly type: "temporary" | "permanent";
}> {}

/**
 * Error representing a not found navigation.
 * @since 1.0.0
 */
export class NotFoundError extends Data.TaggedError("NotFoundError")<Record<string, never>> {}

/**
 * Redirects to the specified URL (307 temporary redirect).
 *
 * This effect triggers a Next.js redirect by calling `redirect()`, which throws
 * a special error that Next.js intercepts to perform the navigation. The thrown
 * error is caught and converted to a typed `RedirectError` that can be handled
 * with `Effect.catchTag("RedirectError", ...)`.
 *
 * @param url - The URL to redirect to
 * @since 1.0.0
 * @category navigation
 * @example
 * ```typescript
 * const effect = Redirect("/dashboard").pipe(
 *   Effect.catchTag("RedirectError", (error) =>
 *     Effect.succeed(`Redirecting to ${error.url}`)
 *   )
 * )
 * ```
 */
export const Redirect = (url: string): Effect.Effect<never, RedirectError, never> =>
  Effect.fail(new RedirectError({ type: "temporary", url }));

/**
 * Redirects to the specified URL (308 permanent redirect).
 *
 * This effect triggers a Next.js permanent redirect by calling `permanentRedirect()`,
 * which throws a special error that Next.js intercepts. The thrown error is caught
 * and converted to a typed `RedirectError` that can be handled with
 * `Effect.catchTag("RedirectError", ...)`.
 *
 * @param url - The URL to redirect to
 * @since 1.0.0
 * @category navigation
 * @example
 * ```typescript
 * const effect = PermanentRedirect("/new-location").pipe(
 *   Effect.catchTag("RedirectError", (error) =>
 *     Effect.succeed(`Permanently redirecting to ${error.url}`)
 *   )
 * )
 * ```
 */
export const PermanentRedirect = (url: string): Effect.Effect<never, RedirectError, never> =>
  Effect.fail(new RedirectError({ type: "permanent", url }));

/**
 * Renders the not-found page.
 *
 * This effect triggers Next.js's not-found handling by calling `notFound()`,
 * which throws a special error that Next.js intercepts. The thrown error is caught
 * and converted to a typed `NotFoundError` that can be handled with
 * `Effect.catchTag("NotFoundError", ...)`.
 *
 * @since 1.0.0
 * @category navigation
 * @example
 * ```typescript
 * const effect = NotFound.pipe(
 *   Effect.catchTag("NotFoundError", () =>
 *     Effect.succeed("Rendering 404 page")
 *   )
 * )
 * ```
 */
export const NotFound: Effect.Effect<never, NotFoundError, never> = Effect.fail(
  new NotFoundError({})
);
