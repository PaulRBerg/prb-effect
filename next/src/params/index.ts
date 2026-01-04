import "server-only";

/**
 */
import { Effect, Schema } from "effect";

type NextBaseParams = Promise<Record<string, string | string[] | undefined>>;

/**
 * Decodes route params using a Schema with unknown input.
 *
 * @category params
 */
export const decodeParamsUnknown =
  <S extends Schema.Schema.Any, P extends NextBaseParams>(schema: S) =>
  (params: P) =>
    Effect.promise(() => params).pipe(Effect.flatMap(Schema.decodeUnknown(schema)));

/**
 * Decodes search params using a Schema with unknown input.
 *
 * @category params
 */
export const decodeSearchParamsUnknown =
  <S extends Schema.Schema.Any, P extends NextBaseParams>(schema: S) =>
  (searchParams: P) =>
    Effect.promise(() => searchParams).pipe(Effect.flatMap(Schema.decodeUnknown(schema)));

/**
 * Decodes params using a Schema with typed input.
 *
 * @category params
 */
export const decodeParams =
  <T, P>(schema: Schema.Schema<T, P>) =>
  (params: Promise<P>) =>
    Effect.promise(() => params).pipe(Effect.flatMap(Schema.decode(schema)));
