/**
 * Server action utilities for running Effect-based server actions in Next.js.
 *
 * @example
 * ```typescript
 * import { runServerAction } from "effect-next/action";
 *
 * export async function myAction() {
 *   return runServerAction(myEffect, { runtime });
 * }
 * ```
 * @module
 * @since 1.0.0
 */
export * from "./run-server-action.js";
export * from "./types.js";
