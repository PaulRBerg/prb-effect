import "server-only";
import type { Layer } from "effect";
import type * as ManagedRuntime from "effect/ManagedRuntime";
import type * as NextMiddleware from "../middleware/index.js";
import * as Next from "./next.js";

type BaseHandlerTags = {
  readonly Layout?: string;
  readonly Page?: string;
  readonly Route?: string;
};

type RuntimeLayer = { readonly _tag: "RuntimeLayer"; readonly _R: unknown };

type MiddlewareUnion<M> = M extends readonly (infer T)[]
  ? T extends NextMiddleware.TagClassAny
    ? T
    : never
  : never;

type BaseHandlersOptions<R, E, M extends readonly NextMiddleware.TagClassAny[] | undefined> = {
  readonly layer?: Layer.Layer<R, E, never>;
  readonly runtime?: ManagedRuntime.ManagedRuntime<R, E>;
  readonly middlewares?: M;
};

const resolveTags = (tags: string | BaseHandlerTags) => {
  if (typeof tags === "string") {
    return { Layout: tags, Page: tags, Route: tags };
  }
  const fallback = tags.Layout ?? tags.Page ?? tags.Route;
  if (!fallback) {
    throw new Error("At least one handler tag must be provided");
  }
  return {
    Layout: tags.Layout ?? fallback,
    Page: tags.Page ?? fallback,
    Route: tags.Route ?? fallback,
  };
};

const applyMiddlewares = <M extends readonly NextMiddleware.TagClassAny[] | undefined>(
  handler: Next.Next<string, Layer.Layer.Any | RuntimeLayer | undefined, never>,
  middlewares: M
): Next.Next<string, Layer.Layer.Any | RuntimeLayer | undefined, MiddlewareUnion<M>> => {
  if (!middlewares || middlewares.length === 0) {
    return handler as Next.Next<
      string,
      Layer.Layer.Any | RuntimeLayer | undefined,
      MiddlewareUnion<M>
    >;
  }

  return middlewares.reduce(
    (acc, middleware) => acc.middleware(middleware),
    handler as Next.Next<
      string,
      Layer.Layer.Any | RuntimeLayer | undefined,
      NextMiddleware.TagClassAny
    >
  ) as Next.Next<string, Layer.Layer.Any | RuntimeLayer | undefined, MiddlewareUnion<M>>;
};

/**
 * Creates pre-configured handlers for pages, layouts, and routes.
 *
 * Provide a single tag string to share a handler, or per-handler tags to
 * generate distinct handlers that share the same runtime.
 */
export function createBaseHandlers<
  R,
  E,
  M extends readonly NextMiddleware.TagClassAny[] | undefined = undefined,
>(tags: string | BaseHandlerTags, options: BaseHandlersOptions<R, E, M>) {
  if (!(options.runtime || options.layer)) {
    throw new Error("Either runtime or layer must be provided");
  }

  const resolvedTags = resolveTags(tags);

  const base = options.runtime
    ? Next.makeWithRuntime(resolvedTags.Layout, options.runtime)
    : Next.make(resolvedTags.Layout, options.layer as Layer.Layer<R, E, never>);

  const runtime = base.runtime as ManagedRuntime.ManagedRuntime<R, E>;

  const makeHandler = (tag: string) =>
    tag === base._tag ? base : Next.makeWithRuntime(tag, runtime);

  if (resolvedTags.Layout === resolvedTags.Page && resolvedTags.Layout === resolvedTags.Route) {
    const shared = applyMiddlewares(makeHandler(resolvedTags.Layout), options.middlewares);
    return {
      Layout: shared,
      Page: shared,
      Route: shared,
    };
  }

  return {
    /**
     * Create a layout handler.
     */
    Layout: applyMiddlewares(makeHandler(resolvedTags.Layout), options.middlewares),
    /**
     * Create a page handler.
     */
    Page: applyMiddlewares(makeHandler(resolvedTags.Page), options.middlewares),

    /**
     * Create an API route handler.
     */
    Route: applyMiddlewares(makeHandler(resolvedTags.Route), options.middlewares),
  };
}
