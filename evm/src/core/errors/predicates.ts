/** Shape of Effect-TS tagged errors with optional contract metadata */
export type TaggedErrorShape = {
  readonly _tag: string;
  readonly message: string;
  readonly address?: string;
  readonly functionName?: string;
  readonly cause?: unknown;
};

/**
 * Check if an error has the shape of a tagged error (has _tag property).
 * Use this for general tagged error detection without checking a specific tag.
 */
export const hasTaggedErrorShape = (error: unknown): error is TaggedErrorShape =>
  error !== null && typeof error === "object" && "_tag" in error && typeof error._tag === "string";

/**
 * Creates a type guard for tagged errors with a specific tag.
 * Works with both instanceof checks and _tag property (for serialized errors).
 */
export const isTaggedError =
  <T extends { readonly _tag: string }>(tag: T["_tag"]) =>
  (error: unknown): error is T =>
    hasTaggedErrorShape(error) && error._tag === tag;
