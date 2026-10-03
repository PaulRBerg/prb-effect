/**
 */
import "server-only";
import { Data, Effect } from "effect";

/**
 * Error representing a redirect navigation.
 */
export class RedirectError extends Data.TaggedError("RedirectError")<{
  readonly url: string;
  readonly type: "temporary" | "permanent";
}> {}

/**
 * Error representing a not found navigation.
 */
export class NotFoundError extends Data.TaggedError("NotFoundError")<Record<string, never>> {}

/**
 * Redirects to the specified URL (307 temporary redirect).
 *
 * Fails with a typed `RedirectError`, which can be handled with
 * `Effect.catchTag("RedirectError", ...)`. If unhandled, the package executor
 * calls Next.js `redirect()` at the handler boundary.
 *
 * @param url - The URL to redirect to
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
 * Fails with a typed `RedirectError`, which can be handled with
 * `Effect.catchTag("RedirectError", ...)`. If unhandled, the package executor
 * calls Next.js `permanentRedirect()` at the handler boundary.
 *
 * @param url - The URL to redirect to
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
 * Fails with a typed `NotFoundError`, which can be handled with
 * `Effect.catchTag("NotFoundError", ...)`. If unhandled, the package executor
 * calls Next.js `notFound()` at the handler boundary.
 *
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
