import { describe, expect, it } from "@effect/vitest";
import { Effect, Schema } from "effect";
import { vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// Import after mocks
const { decodeParamsUnknown, decodeSearchParamsUnknown, decodeParams } = await import("./index.js");

describe("params", () => {
  describe("decodeParamsUnknown", () => {
    const ParamsSchema = Schema.Struct({
      id: Schema.String,
      slug: Schema.String,
    });

    it("succeeds with valid input matching schema", async () => {
      const params = Promise.resolve({ id: "123", slug: "test-post" });
      const effect = decodeParamsUnknown(ParamsSchema)(params);

      const result = await Effect.runPromise(effect as any);

      expect(result).toEqual({ id: "123", slug: "test-post" });
    });

    it("fails with invalid input missing required keys", async () => {
      const params = Promise.resolve({ id: "123" });
      const effect = decodeParamsUnknown(ParamsSchema)(params);

      await expect(Effect.runPromise(effect as any)).rejects.toThrow();
    });

    it("fails with wrong type for keys", async () => {
      const params = Promise.resolve({
        id: 123,
        slug: "test",
      }) as unknown as Promise<Record<string, string | string[] | undefined>>;
      const effect = decodeParamsUnknown(ParamsSchema)(params);

      await expect(Effect.runPromise(effect as any)).rejects.toThrow();
    });

    it("works with coercion schemas", async () => {
      const CoercionSchema = Schema.Struct({
        id: Schema.NumberFromString,
        page: Schema.NumberFromString,
      });

      const params = Promise.resolve({ id: "42", page: "10" });
      const effect = decodeParamsUnknown(CoercionSchema)(params);

      const result = await Effect.runPromise(effect as any);

      expect(result).toEqual({ id: 42, page: 10 });
    });

    it("fails with invalid coercion input", async () => {
      const CoercionSchema = Schema.Struct({
        id: Schema.NumberFromString,
      });

      const params = Promise.resolve({ id: "not-a-number" });
      const effect = decodeParamsUnknown(CoercionSchema)(params);

      await expect(Effect.runPromise(effect as any)).rejects.toThrow();
    });
  });

  describe("decodeSearchParamsUnknown", () => {
    const SearchParamsSchema = Schema.Struct({
      page: Schema.optional(Schema.String),
      query: Schema.String,
    });

    it("succeeds with valid input matching schema", async () => {
      const searchParams = Promise.resolve({ page: "1", query: "test" });
      const effect = decodeSearchParamsUnknown(SearchParamsSchema)(searchParams);

      const result = await Effect.runPromise(effect as any);

      expect(result).toEqual({ page: "1", query: "test" });
    });

    it("succeeds with optional fields missing", async () => {
      const searchParams = Promise.resolve({ query: "test" });
      const effect = decodeSearchParamsUnknown(SearchParamsSchema)(searchParams);

      const result = await Effect.runPromise(effect as any);

      expect(result).toEqual({ query: "test" });
    });

    it("fails with invalid input missing required keys", async () => {
      const searchParams = Promise.resolve({ page: "1" });
      const effect = decodeSearchParamsUnknown(SearchParamsSchema)(searchParams);

      await expect(Effect.runPromise(effect as any)).rejects.toThrow();
    });

    it("works with coercion schemas", async () => {
      const CoercionSchema = Schema.Struct({
        limit: Schema.NumberFromString,
        page: Schema.NumberFromString,
      });

      const searchParams = Promise.resolve({ limit: "50", page: "2" });
      const effect = decodeSearchParamsUnknown(CoercionSchema)(searchParams);

      const result = await Effect.runPromise(effect as any);

      expect(result).toEqual({ limit: 50, page: 2 });
    });
  });

  describe("decodeParams", () => {
    const TypedSchema = Schema.Struct({
      id: Schema.String,
      slug: Schema.String,
    });

    it("succeeds when Promise<P> matches schema input", async () => {
      const params = Promise.resolve({ id: "456", slug: "another-post" });
      const effect = decodeParams(TypedSchema)(params);

      const result = await Effect.runPromise(effect as any);

      expect(result).toEqual({ id: "456", slug: "another-post" });
    });

    it("fails when input doesn't satisfy schema", async () => {
      const params = Promise.resolve({ id: "456" }) as unknown as Promise<{
        id: string;
        slug: string;
      }>;
      const effect = decodeParams(TypedSchema)(params);

      await expect(Effect.runPromise(effect as any)).rejects.toThrow();
    });

    it("works with transformation schemas", async () => {
      const TransformSchema = Schema.transform(
        Schema.Struct({
          id: Schema.String,
        }),
        Schema.Struct({
          id: Schema.Number,
        }),
        {
          decode: (input) => ({ id: Number.parseInt(input.id, 10) }),
          encode: (output) => ({ id: String(output.id) }),
        }
      );

      const params = Promise.resolve({ id: "789" });
      const effect = decodeParams(TransformSchema)(params);

      const result = await Effect.runPromise(effect as any);

      expect(result).toEqual({ id: 789 });
    });
  });
});
