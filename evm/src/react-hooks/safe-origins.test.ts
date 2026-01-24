import { describe, expect, it, vi } from "vitest";

function loadSafeOrigins() {
  vi.resetModules();
  return import("./safe-origins.js");
}

describe("safe-origins", () => {
  it("normalizes origins and dedupes", async () => {
    const { getSafeOrigins, setSafeOrigins } = await loadSafeOrigins();

    setSafeOrigins([
      "https://safe.global/",
      " safe.global",
      "https://safe.global/apps",
      "ftp://safe.global",
    ]);

    expect(getSafeOrigins()).toEqual(["https://safe.global"]);
  });

  it("is configurable only once", async () => {
    const { extendSafeOrigins, setSafeOrigins } = await loadSafeOrigins();

    setSafeOrigins(["https://safe.global"]);

    expect(() => setSafeOrigins(["https://app.safe.global"])).toThrow(
      "Safe origins already configured."
    );
    expect(() => extendSafeOrigins(["https://app.safe.global"])).toThrow(
      "Safe origins already configured."
    );
  });

  it("notifies subscribers on configuration", async () => {
    const { setSafeOrigins, subscribeSafeOrigins } = await loadSafeOrigins();
    const calls: number[] = [];
    const unsubscribe = subscribeSafeOrigins(() => {
      calls.push(1);
    });

    setSafeOrigins(["https://safe.custom"]);

    expect(calls).toHaveLength(1);
    unsubscribe();
  });
});
