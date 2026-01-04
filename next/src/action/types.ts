import { Data } from "effect";

/**
 * Tagged error type for server action failures.
 */
export class ServerActionError extends Data.TaggedError("ServerActionError")<{
  readonly errorTag: string | null;
  readonly message: string;
}> {}

/**
 * Result type for server actions - discriminated union.
 */
export type ServerActionResult<A> =
  | { readonly success: true; readonly data: A }
  | { readonly success: false; readonly error: ServerActionError };
