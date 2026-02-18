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

    const { useWalletExecution } = await import("./use-wallet-execution.js");

    const snapshots: string[] = [];
    const Probe = (): null => {
      const value = useWalletExecution();
      React.useEffect(() => {
        snapshots.push(value.detectionSource);
      }, [value.detectionSource]);
      return null;
    };

    const { cleanup } = render(React.createElement(Probe));
    await act(async () => {
      await flush();
    });

    expect(snapshots.at(-1)).toBe("safe-context");
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

    const { useWalletExecution } = await import("./use-wallet-execution.js");

    const snapshots: string[] = [];
    const Probe = (): null => {
      const value = useWalletExecution();
      React.useEffect(() => {
        snapshots.push(value.detectionSource);
      }, [value.detectionSource]);
      return null;
    };

    const { cleanup } = render(React.createElement(Probe));
    await act(async () => {
      await flush();
    });

    expect(snapshots.at(-1)).toBe("safe-connector");
    cleanup();
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

    const { useWalletExecution } = await import("./use-wallet-execution.js");

    const snapshots: string[] = [];
    const Probe = (): null => {
      const value = useWalletExecution();
      React.useEffect(() => {
        snapshots.push(value.detectionSource);
      }, [value.detectionSource]);
      return null;
    };

    const { cleanup } = render(React.createElement(Probe));
    await act(async () => {
      await flush();
      await flush();
    });

    expect(snapshots).toContain("owners-probe");
    cleanup();
  });
});
