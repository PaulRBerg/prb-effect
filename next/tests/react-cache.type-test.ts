import type { Scope } from "effect";
import { Effect } from "effect";
import { reactCache } from "../src/react-cache/index.js";

const scoped: Effect.Effect<number, never, Scope.Scope> = Effect.acquireRelease(
  Effect.succeed(1),
  () => Effect.void
);
// @ts-expect-error A cached execution cannot own a caller's resource scope.
reactCache(() => scoped);
reactCache(() => Effect.scoped(scoped));
