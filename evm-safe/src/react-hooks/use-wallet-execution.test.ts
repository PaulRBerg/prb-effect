// @vitest-environment jsdom

import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

const globalWithAct = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean;
};
globalWithAct.IS_REACT_ACT_ENVIRONMENT = true;

const render = (node: React.ReactElement) => {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  void act(() => {
    root.render(node);
  });
  return {
    cleanup: () => {
      void act(() => {
        root.unmount();
      });
      container.remove();
    },
  };
};

describe("useWalletExecution", () => {
  it("prefers safe-context detection", async () => {
    vi.resetModules();
    vi.doMock("wagmi", () => ({
      useAccount: () => ({ address: undefined, connector: undefined, isConnected: false }),
      usePublicClient: () => undefined,
    }));
    vi.doMock("./use-is-safe-app-context.js", () => ({
      useIsSafeAppContext: () => true,
    }));

    const { canUseSafeAppsExecution, useWalletExecution } = await import(
      "./use-wallet-execution.js"
    );

    const snapshots: ReturnType<typeof useWalletExecution>[] = [];
    const Probe = (): null => {
      const value = useWalletExecution();
      React.useEffect(() => {
        snapshots.push(value);
      }, [value]);
      return null;
    };

    const { cleanup } = render(React.createElement(Probe));
    await act(async () => {
      await flush();
    });

    const latest = snapshots.at(-1);
    expect(latest).toMatchObject({
      canUseSafeAppsSdk: true,
      detectionSource: "safe-context",
      host: "safe",
      walletType: "safe-multisig",
      safeAppsExecution: {
        available: true,
        host: "safe-app",
        source: "safe-context",
      },
    });
    expect(latest ? canUseSafeAppsExecution(latest) : false).toBe(true);
    cleanup();
  });

  it("detects Safe connector when context is false", async () => {
    vi.resetModules();
    vi.doMock("wagmi", () => ({
      useAccount: () => ({
        address: "0x0000000000000000000000000000000000000001",
        connector: { id: "safe" },
        isConnected: true,
      }),
      usePublicClient: () => undefined,
    }));
    vi.doMock("./use-is-safe-app-context.js", () => ({
      useIsSafeAppContext: () => false,
    }));

    const { canUseSafeAppsExecution, useWalletExecution } = await import(
      "./use-wallet-execution.js"
    );

    const snapshots: ReturnType<typeof useWalletExecution>[] = [];
    const Probe = (): null => {
      const value = useWalletExecution();
      React.useEffect(() => {
        snapshots.push(value);
      }, [value]);
      return null;
    };

    const { cleanup } = render(React.createElement(Probe));
    await act(async () => {
      await flush();
    });

    const latest = snapshots.at(-1);
    expect(latest).toMatchObject({
      canUseSafeAppsSdk: false,
      detectionSource: "safe-connector",
      host: "browser",
      walletType: "safe-multisig",
      safeAppsExecution: {
        available: false,
        host: "browser",
        reason: "not-safe-app-host",
      },
    });
    expect(latest ? canUseSafeAppsExecution(latest) : true).toBe(false);
    cleanup();
  });

  it("prefers Safe host detection over Safe connector for SDK execution", async () => {
    vi.resetModules();
    vi.doMock("wagmi", () => ({
      useAccount: () => ({
        address: "0x0000000000000000000000000000000000000001",
        connector: { id: "safe" },
        isConnected: true,
      }),
      usePublicClient: () => undefined,
    }));
    vi.doMock("./use-is-safe-app-context.js", () => ({
      useIsSafeAppContext: () => false,
    }));

    const originalParent = window.parent;
    Object.defineProperty(window, "parent", {
      configurable: true,
      value: { location: { origin: "https://safe.custom" } },
    });

    const { setSafeAppOrigins } = await import("./safe-app-origins.js");
    const { useWalletExecution } = await import("./use-wallet-execution.js");
    setSafeAppOrigins(["https://safe.custom"]);

    const snapshots: ReturnType<typeof useWalletExecution>[] = [];
    const Probe = (): null => {
      const value = useWalletExecution();
      React.useEffect(() => {
        snapshots.push(value);
      }, [value]);
      return null;
    };

    const { cleanup } = render(React.createElement(Probe));
    await act(async () => {
      await flush();
    });

    expect(snapshots.at(-1)).toMatchObject({
      canUseSafeAppsSdk: true,
      detectionSource: "safe-origin",
      host: "safe",
      walletType: "safe-multisig",
      safeAppsExecution: {
        available: true,
        host: "safe-app",
        source: "safe-origin",
      },
    });
    cleanup();

    Object.defineProperty(window, "parent", {
      configurable: true,
      value: originalParent,
    });
  });

  it("falls back to owners-probe when connector/context/origin are not Safe", async () => {
    vi.resetModules();
    vi.doMock("wagmi", () => ({
      useAccount: () => ({
        address: "0x0000000000000000000000000000000000000001",
        connector: { id: "injected" },
        isConnected: true,
      }),
      usePublicClient: () => ({
        readContract: () =>
          Promise.resolve([
            "0x0000000000000000000000000000000000000001",
            "0x0000000000000000000000000000000000000002",
          ]),
      }),
    }));
    vi.doMock("./use-is-safe-app-context.js", () => ({
      useIsSafeAppContext: () => false,
    }));

    const { canUseSafeAppsExecution, useWalletExecution } = await import(
      "./use-wallet-execution.js"
    );

    const snapshots: ReturnType<typeof useWalletExecution>[] = [];
    const Probe = (): null => {
      const value = useWalletExecution();
      React.useEffect(() => {
        snapshots.push(value);
      }, [value]);
      return null;
    };

    const { cleanup } = render(React.createElement(Probe));
    await act(async () => {
      await flush();
      await flush();
    });

    const ownersProbeSnapshot = snapshots.find(
      (snapshot) => snapshot.detectionSource === "owners-probe"
    );
    expect(ownersProbeSnapshot).toMatchObject({
      canUseSafeAppsSdk: false,
      host: "browser",
      walletType: "safe-multisig",
      safeAppsExecution: {
        available: false,
        host: "browser",
        reason: "not-safe-app-host",
      },
    });
    expect(ownersProbeSnapshot ? canUseSafeAppsExecution(ownersProbeSnapshot) : true).toBe(false);
    cleanup();
  });

  it("throws a recovery-tagged error when Safe Apps execution is unavailable", async () => {
    vi.resetModules();

    const { assertSafeAppsExecutionAvailable } = await import("./use-wallet-execution.js");

    try {
      assertSafeAppsExecutionAvailable({
        available: false,
        host: "browser",
        reason: "not-safe-app-host",
      });
      expect.fail("Expected assertSafeAppsExecutionAvailable to throw");
    } catch (error) {
      expect(error).toMatchObject({
        _tag: "NotInSafeAppContextError",
        code: "TOP_LEVEL_WINDOW",
        recovery: "open-in-safe",
        userMessage: "Open this flow in Safe to use Safe Apps SDK execution.",
      });
    }
  });
});
