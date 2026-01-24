import { describe, expect, it, vi } from "vitest";

function loadSafeAppOrigins() {
  vi.resetModules();
  return import("./safe-app-origins.js");
}

describe("safe-app-origins", () => {
  it("normalizes origins and dedupes", async () => {
    const { getSafeAppOrigins, setSafeAppOrigins } = await loadSafeAppOrigins();

    setSafeAppOrigins([
      "https://safe.global/",
      " safe.global",
      "https://safe.global/apps",
      "ftp://safe.global",
    ]);

    expect(getSafeAppOrigins()).toEqual(["https://safe.global"]);
  });

  it("is configurable only once", async () => {
    const { extendSafeAppOrigins, setSafeAppOrigins } = await loadSafeAppOrigins();

    setSafeAppOrigins(["https://safe.global"]);

    expect(() => setSafeAppOrigins(["https://app.safe.global"])).toThrow(
      "Safe App origins already configured."
    );
    expect(() => extendSafeAppOrigins(["https://app.safe.global"])).toThrow(
      "Safe App origins already configured."
    );
  });

  it("notifies subscribers on configuration", async () => {
    const { setSafeAppOrigins, subscribeSafeAppOrigins } = await loadSafeAppOrigins();
    const calls: number[] = [];
    const unsubscribe = subscribeSafeAppOrigins(() => {
      calls.push(1);
    });

    setSafeAppOrigins(["https://safe.custom"]);

    expect(calls).toHaveLength(1);
    unsubscribe();
  });
});
