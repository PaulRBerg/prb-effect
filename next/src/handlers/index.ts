/**
 * Route handler utilities for running Effect-based handlers in Next.js App Router.
 *
 * @example
 * ```typescript
 * import { make } from "@prb/effect-next/handlers";
 * import { Effect, Layer } from "effect";
 *
 * export const GET = make("Hello", Layer.empty).build(() =>
 *   Effect.succeed({ message: "Hello" })
 * );
 * ```
 * @module
 */
export * from "./base-handlers.js";
export type { Next as NextHandler } from "./next.js";
export * as Next from "./next.js";
export { make, makeWithRuntime } from "./next.js";
