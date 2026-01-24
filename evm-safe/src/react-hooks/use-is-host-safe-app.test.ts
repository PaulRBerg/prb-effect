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

describe("useIsHostSafeApp", () => {
  it("updates when Safe App origins are configured after mount", async () => {
    vi.resetModules();
    vi.doMock("./use-is-safe-app-context.js", () => ({
      useIsSafeAppContext: () => false,
    }));

    const { useIsHostSafeApp } = await import("./use-is-host-safe-app.js");
    const { setSafeAppOrigins } = await import("./safe-app-origins.js");

    const originalParent = window.parent;
    const parent = { location: { origin: "https://safe.custom" } };
    Object.defineProperty(window, "parent", { configurable: true, value: parent });

    const values: boolean[] = [];
    const Probe = (): null => {
      const value = useIsHostSafeApp();
      React.useEffect(() => {
        values.push(value);
      }, [value]);
      return null;
    };

    const { cleanup } = render(React.createElement(Probe));

    await act(async () => {
      await flush();
    });

    expect(values.at(-1)).toBe(false);

    await act(async () => {
      setSafeAppOrigins(["https://safe.custom"]);
      await flush();
    });

    expect(values.at(-1)).toBe(true);
    cleanup();

    Object.defineProperty(window, "parent", {
      configurable: true,
      value: originalParent,
    });
  });
});
