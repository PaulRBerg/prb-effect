import { AsyncLocalStorage } from "node:async_hooks";
import { describe, expect, it } from "@effect/vitest";
import type { AsyncStorageDeps, CapturedContext } from "./async-context.js";
import { captureContext, createContextWrapper, withRestoredContext } from "./async-context.js";

describe("captureContext", () => {
  it("returns workStore and workUnitStore from deps getStore()", () => {
    const workStore = { work: "data" };
    const workUnitStore = { workUnit: "data" };

    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const result = workAsyncStorage.run(workStore, () =>
      workUnitAsyncStorage.run(workUnitStore, () => captureContext(deps))
    );

    expect(result.workStore).toBe(workStore);
    expect(result.workUnitStore).toBe(workUnitStore);
  });

  it("returns undefined for missing stores", () => {
    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const result = captureContext(deps);

    expect(result.workStore).toBeUndefined();
    expect(result.workUnitStore).toBeUndefined();
  });
});

describe("withRestoredContext", () => {
  it("restores both stores when both captured", () => {
    const workStore = { work: "data" };
    const workUnitStore = { workUnit: "data" };

    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const context: CapturedContext = {
      workStore,
      workUnitStore,
    };

    const fn = () => ({
      capturedWork: workAsyncStorage.getStore(),
      capturedWorkUnit: workUnitAsyncStorage.getStore(),
    });

    const wrapped = withRestoredContext(context, deps, fn);
    const result = wrapped();

    expect(result.capturedWork).toBe(workStore);
    expect(result.capturedWorkUnit).toBe(workUnitStore);
  });

  it("restores only workStore when workUnit undefined", () => {
    const workStore = { work: "data" };

    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const context: CapturedContext = {
      workStore,
      workUnitStore: undefined,
    };

    const fn = () => ({
      capturedWork: workAsyncStorage.getStore(),
      capturedWorkUnit: workUnitAsyncStorage.getStore(),
    });

    const wrapped = withRestoredContext(context, deps, fn);
    const result = wrapped();

    expect(result.capturedWork).toBe(workStore);
    expect(result.capturedWorkUnit).toBeUndefined();
  });

  it("restores only workUnitStore when work undefined", () => {
    const workUnitStore = { workUnit: "data" };

    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const context: CapturedContext = {
      workStore: undefined,
      workUnitStore,
    };

    const fn = () => ({
      capturedWork: workAsyncStorage.getStore(),
      capturedWorkUnit: workUnitAsyncStorage.getStore(),
    });

    const wrapped = withRestoredContext(context, deps, fn);
    const result = wrapped();

    expect(result.capturedWork).toBeUndefined();
    expect(result.capturedWorkUnit).toBe(workUnitStore);
  });

  it("runs as-is when neither captured", () => {
    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const context: CapturedContext = {
      workStore: undefined,
      workUnitStore: undefined,
    };

    const fn = () => ({
      capturedWork: workAsyncStorage.getStore(),
      capturedWorkUnit: workUnitAsyncStorage.getStore(),
    });

    const wrapped = withRestoredContext(context, deps, fn);
    const result = wrapped();

    expect(result.capturedWork).toBeUndefined();
    expect(result.capturedWorkUnit).toBeUndefined();
  });

  it("passes arguments through to wrapped function", () => {
    const workStore = { work: "data" };
    const workUnitStore = { workUnit: "data" };

    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const context: CapturedContext = {
      workStore,
      workUnitStore,
    };

    const fn = (a: number, b: string) => `${a}-${b}`;

    const wrapped = withRestoredContext(context, deps, fn);
    const result = wrapped(42, "test");

    expect(result).toBe("42-test");
  });
});

describe("createContextWrapper", () => {
  it("returns higher-order wrapper equivalent to withRestoredContext", () => {
    const workStore = { work: "data" };
    const workUnitStore = { workUnit: "data" };

    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const context: CapturedContext = {
      workStore,
      workUnitStore,
    };

    const wrapper = createContextWrapper(context, deps);

    const fn = () => ({
      capturedWork: workAsyncStorage.getStore(),
      capturedWorkUnit: workUnitAsyncStorage.getStore(),
    });

    const wrapped = wrapper(fn);
    const result = wrapped();

    expect(result.capturedWork).toBe(workStore);
    expect(result.capturedWorkUnit).toBe(workUnitStore);
  });

  it("can wrap multiple functions with same context", () => {
    const workStore = { work: "data" };
    const workUnitStore = { workUnit: "data" };

    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const context: CapturedContext = {
      workStore,
      workUnitStore,
    };

    const wrapper = createContextWrapper(context, deps);

    const fn1 = () => workAsyncStorage.getStore();
    const fn2 = () => workUnitAsyncStorage.getStore();

    const wrapped1 = wrapper(fn1);
    const wrapped2 = wrapper(fn2);

    expect(wrapped1()).toBe(workStore);
    expect(wrapped2()).toBe(workUnitStore);
  });

  it("preserves function arguments through wrapper", () => {
    const workStore = { work: "data" };

    const workAsyncStorage = new AsyncLocalStorage();
    const workUnitAsyncStorage = new AsyncLocalStorage();

    const deps: AsyncStorageDeps = {
      workAsyncStorage,
      workUnitAsyncStorage,
    };

    const context: CapturedContext = {
      workStore,
      workUnitStore: undefined,
    };

    const wrapper = createContextWrapper(context, deps);

    const fn = (x: number, y: number) => x + y;
    const wrapped = wrapper(fn);

    expect(wrapped(10, 20)).toBe(30);
  });
});
