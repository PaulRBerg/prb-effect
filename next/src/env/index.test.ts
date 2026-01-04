import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

// Mock server-only
vi.mock("server-only", () => ({}));

const {
  getEnvironment,
  getEnvironmentSync,
  isDevelopment,
  isProduction,
  isTest,
  resolveEnvironment,
} = await import("./index.js");

describe("env helpers", () => {
  it("defaults to development when resolver returns undefined", () => {
    const env = resolveEnvironment(() => undefined);
    expect(env).toBe("development");
  });

  it("defaults to development when resolver returns invalid value", () => {
    const env = resolveEnvironment(() => "staging");
    expect(env).toBe("development");
  });

  it("resolves production via resolver", () => {
    const env = resolveEnvironment(() => "production");
    expect(env).toBe("production");
  });

  it("getEnvironment returns Effect", async () => {
    const result = await Effect.runPromise(getEnvironment(() => "test"));
    expect(result).toBe("test");
  });

  it("getEnvironmentSync returns value", () => {
    const result = getEnvironmentSync(() => "development");
    expect(result).toBe("development");
  });

  it("boolean helpers reflect resolved env", () => {
    expect(isDevelopment(() => "development")).toBe(true);
    expect(isProduction(() => "production")).toBe(true);
    expect(isTest(() => "test")).toBe(true);
  });
});
