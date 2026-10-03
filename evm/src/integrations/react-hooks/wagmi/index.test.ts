// @vitest-environment jsdom

import type { Config } from "@wagmi/core";
import { Layer } from "effect";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WagmiEffectEvmProvider, WagmiEffectEvmProviderSync } from "./index.js";

const mocks = vi.hoisted(() => ({
  clearProvider: vi.fn(),
  getAccount: vi.fn(),
  setProvider: vi.fn(),
  watchAccount: vi.fn<(...args: unknown[]) => () => void>(() => vi.fn()),
}));
vi.mock("@wagmi/core", () => ({ getAccount: mocks.getAccount, watchAccount: mocks.watchAccount }));
vi.mock("#src/wagmi/index.js", () => ({
  makeEffectEvmLayerFromWagmiWithWalletProviderRef: () => Layer.empty,
}));
vi.mock("../provider.js", () => ({
  EffectEvmProvider: ({ children }: { children: React.ReactNode }) => children,
  EffectEvmProviderSync: ({ fallback }: { fallback?: React.ReactNode }) => fallback,
}));
vi.mock("../wallet-provider-ref.js", () => ({
  useWalletProviderRef: () => ({
    clearProvider: mocks.clearProvider,
    setProvider: mocks.setProvider,
  }),
}));

const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
let root: ReturnType<typeof createRoot> | undefined;

beforeEach(() => vi.clearAllMocks());
afterEach(async () => {
  await act(async () => root?.unmount());
});

async function mount() {
  root = createRoot(document.createElement("div"));
  await act(() => {
    root?.render(
      React.createElement(WagmiEffectEvmProvider, { children: null, config: {} as Config })
    );
  });
  return (mocks.watchAccount.mock.calls[0]?.[1] as { onChange: (account: unknown) => void })
    .onChange;
}

describe("Wagmi wallet provider synchronization", () => {
  it.each([
    "resolve",
    "reject",
  ] as const)("ignores an obsolete provider request that later %s", async (outcome) => {
    const oldRequest = Promise.withResolvers<unknown>();
    const newRequest = Promise.withResolvers<unknown>();
    const oldProvider = { request: vi.fn() };
    const newProvider = { request: vi.fn() };
    mocks.getAccount.mockReturnValue({
      chainId: 1,
      connector: { getProvider: () => oldRequest.promise },
    });
    const change = await mount();
    change({ chainId: 2, connector: { getProvider: () => newRequest.promise } });
    await act(async () => {
      newRequest.resolve(newProvider);
      await newRequest.promise;
    });
    await act(async () => {
      if (outcome === "resolve") oldRequest.resolve(oldProvider);
      else oldRequest.reject(new Error("obsolete provider failed"));
      await oldRequest.promise.catch(() => undefined);
    });
    expect(mocks.setProvider.mock.calls).toEqual([[newProvider]]);
    expect(mocks.clearProvider).not.toHaveBeenCalled();
  });

  it("does not restore a provider after disconnect", async () => {
    const request = Promise.withResolvers<unknown>();
    mocks.getAccount.mockReturnValue({
      chainId: 1,
      connector: { getProvider: () => request.promise },
    });
    const change = await mount();
    change({ connector: undefined });
    await act(async () => {
      request.resolve({ request: vi.fn() });
      await request.promise;
    });
    expect(mocks.clearProvider).toHaveBeenCalledOnce();
    expect(mocks.setProvider).not.toHaveBeenCalled();
  });
});

describe("Wagmi synchronous provider", () => {
  it("forwards fallback to the runtime provider", () => {
    expect(
      renderToString(
        React.createElement(WagmiEffectEvmProviderSync, {
          children: "ready",
          config: {} as Config,
          fallback: "pending",
        })
      )
    ).toBe("pending");
  });
});
