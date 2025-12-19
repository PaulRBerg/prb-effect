import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock Next.js headers
const mockCookies = vi.fn(() => Promise.resolve({ get: vi.fn(() => "cookie-value") }));
const mockHeaders = vi.fn(() => Promise.resolve({ get: vi.fn(() => "header-value") }));
const mockDraftMode = vi.fn(() => Promise.resolve({ isEnabled: false }));

vi.mock("next/headers.js", () => ({
  cookies: mockCookies,
  draftMode: mockDraftMode,
  headers: mockHeaders,
}));

// Import after mocks
const { Cookies, Headers, DraftMode } = await import("./index.js");
const { ContextWrapperService } = await import("../internal/async-context.js");

describe("headers", () => {
  describe("Cookies", () => {
    it("returns cookies when ContextWrapperService provided", async () => {
      const mockWrapper = <A extends readonly unknown[], R>(fn: (...args: A) => R) => fn;

      const effect = Effect.gen(function* () {
        const cookies = yield* Cookies();
        return cookies;
      }).pipe(Effect.provideService(ContextWrapperService, mockWrapper));

      const result = await Effect.runPromise(effect);

      expect(result).toEqual({ get: expect.any(Function) });
      expect(mockCookies).toHaveBeenCalled();
    });

    it("invokes the wrapper function", async () => {
      const mockWrapper = vi.fn(
        <Args extends readonly unknown[], R>(fn: (...args: Args) => R) => fn
      );

      const effect = Effect.gen(function* () {
        yield* Cookies();
      }).pipe(Effect.provideService(ContextWrapperService, mockWrapper as any));

      await Effect.runPromise(effect);

      expect(mockWrapper).toHaveBeenCalledWith(mockCookies);
    });
  });

  describe("Headers", () => {
    it("returns headers when ContextWrapperService provided", async () => {
      const mockWrapper = <A extends readonly unknown[], R>(fn: (...args: A) => R) => fn;

      const effect = Effect.gen(function* () {
        const headers = yield* Headers();
        return headers;
      }).pipe(Effect.provideService(ContextWrapperService, mockWrapper));

      const result = await Effect.runPromise(effect);

      expect(result).toEqual({ get: expect.any(Function) });
      expect(mockHeaders).toHaveBeenCalled();
    });

    it("invokes the wrapper function", async () => {
      const mockWrapper = vi.fn(
        <Args extends readonly unknown[], R>(fn: (...args: Args) => R) => fn
      );

      const effect = Effect.gen(function* () {
        yield* Headers();
      }).pipe(Effect.provideService(ContextWrapperService, mockWrapper as any));

      await Effect.runPromise(effect);

      expect(mockWrapper).toHaveBeenCalledWith(mockHeaders);
    });
  });

  describe("DraftMode", () => {
    it("returns draft mode state when ContextWrapperService provided", async () => {
      const mockWrapper = <A extends readonly unknown[], R>(fn: (...args: A) => R) => fn;

      const effect = Effect.gen(function* () {
        const draft = yield* DraftMode();
        return draft;
      }).pipe(Effect.provideService(ContextWrapperService, mockWrapper));

      const result = await Effect.runPromise(effect);

      expect(result).toEqual({ isEnabled: false });
      expect(mockDraftMode).toHaveBeenCalled();
    });

    it("invokes the wrapper function", async () => {
      const mockWrapper = vi.fn(
        <Args extends readonly unknown[], R>(fn: (...args: Args) => R) => fn
      );

      const effect = Effect.gen(function* () {
        yield* DraftMode();
      }).pipe(Effect.provideService(ContextWrapperService, mockWrapper as any));

      await Effect.runPromise(effect);

      expect(mockWrapper).toHaveBeenCalledWith(mockDraftMode);
    });
  });
});
