import "server-only";
import type { Layer } from "effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import * as Next from "./next.js";

type BaseHandlersOptions<R, E> = {
  readonly layer?: Layer.Layer<R, E, never>;
  readonly runtime?: ManagedRuntime.ManagedRuntime<R, E>;
};

/**
 * Creates pre-configured handlers for pages, layouts, and routes.
 */
export function createBaseHandlers<R, E>(tag: string, options: BaseHandlersOptions<R, E>) {
  if (!(options.runtime || options.layer)) {
    throw new Error("Either runtime or layer must be provided");
  }

  const base = options.runtime
    ? Next.makeWithRuntime(tag, options.runtime)
    : Next.make(tag, options.layer as Layer.Layer<R, E, never>);

  return {
    /**
     * Create a layout handler.
     */
    Layout: base,
    /**
     * Create a page handler.
     */
    Page: base,

    /**
     * Create an API route handler.
     */
    Route: base,
  };
}
