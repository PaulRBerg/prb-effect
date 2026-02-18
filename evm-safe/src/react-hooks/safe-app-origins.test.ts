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

  it("allows replacing origins multiple times", async () => {
    const { getSafeAppOrigins, setSafeAppOrigins } = await loadSafeAppOrigins();

    setSafeAppOrigins(["https://safe.global"]);
    setSafeAppOrigins(["https://app.safe.global"]);

    expect(getSafeAppOrigins()).toEqual(["https://app.safe.global"]);
  });

  it("allows extending origins multiple times", async () => {
    const { extendSafeAppOrigins, getSafeAppOrigins, setSafeAppOrigins } =
      await loadSafeAppOrigins();

    setSafeAppOrigins(["https://safe.global"]);
    extendSafeAppOrigins(["https://safe.custom"]);
    extendSafeAppOrigins(["https://safe.custom", "https://safe.extra"]);

    expect(getSafeAppOrigins()).toEqual([
      "https://safe.global",
      "https://safe.custom",
      "https://safe.extra",
    ]);
  });

  it("notifies subscribers on configuration", async () => {
    const { setSafeAppOrigins, subscribeSafeAppOrigins } = await loadSafeAppOrigins();
    const listener = vi.fn();
    const unsubscribe = subscribeSafeAppOrigins(listener);

    setSafeAppOrigins(["https://safe.custom"]);

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it("does not notify subscribers on no-op updates", async () => {
    const { extendSafeAppOrigins, setSafeAppOrigins, subscribeSafeAppOrigins } =
      await loadSafeAppOrigins();
    const listener = vi.fn();
    const unsubscribe = subscribeSafeAppOrigins(listener);

    setSafeAppOrigins(["https://safe.global"]);
    expect(listener).toHaveBeenCalledTimes(1);

    extendSafeAppOrigins([" safe.global ", "https://safe.global/"]);
    setSafeAppOrigins(["https://safe.global"]);
    expect(listener).toHaveBeenCalledTimes(1);

    unsubscribe();
  });
});
