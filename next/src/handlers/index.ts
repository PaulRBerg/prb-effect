/**
 * Route handler utilities for running Effect-based handlers in Next.js App Router.
 *
 * @example
 * ```typescript
 * import { make } from "effect-next/handlers";
 *
 * export const GET = make((request, context) =>
 *   Effect.succeed({ message: "Hello" })
 * );
 * ```
 * @module
 * @since 1.0.0
 */
export * from "./base-handlers.js";
export type { Next as NextHandler } from "./next.js";
export * as Next from "./next.js";
export { make, makeWithRuntime } from "./next.js";
