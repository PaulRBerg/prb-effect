// @vitest-environment jsdom

import { Effect } from "effect";
import * as React from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { PersistedTx } from "#src/platform/browser/tx-store/index.js";
import { InMemoryTxStoreLive, TxStore } from "#src/platform/browser/tx-store/index.js";
import { TEST_TX_HASH } from "#src/testing-kit/index.js";
import { EffectEvmProviderSync, useEffectEvmRuntime } from "./index.js";
import { useInFlightTxs, useTxStoreChanges } from "./tx-store.js";

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

function makeTx(status: PersistedTx["status"]): PersistedTx {
  return {
    chainId: 1,
    createdAt: Date.now(),
    currentHash: TEST_TX_HASH,
    id: `1:${TEST_TX_HASH}`,
    replacements: [],
    rootHash: TEST_TX_HASH,
    status,
    updatedAt: Date.now(),
  };
}

describe("tx store hooks", () => {
  it("useInFlightTxs updates as transactions enter and leave in-flight set", async () => {
    const runtimeRef: { current: ReturnType<typeof useEffectEvmRuntime> | null } = {
      current: null,
    };
    const counts: number[] = [];

    const Probe = (): null => {
      const runtime = useEffectEvmRuntime();
      const inFlight = useInFlightTxs();

      React.useEffect(() => {
        runtimeRef.current = runtime;
      }, [runtime]);

      React.useEffect(() => {
        counts.push(inFlight.length);
      }, [inFlight.length]);

      return null;
    };

    const { cleanup } = render(
      React.createElement(EffectEvmProviderSync, {
        children: React.createElement(Probe),
        layer: InMemoryTxStoreLive,
      })
    );

    await act(async () => {
      await flush();
      await flush();
    });

    await act(async () => {
      await runtimeRef.current?.runPromise(
        Effect.gen(function* () {
          const txStore = yield* TxStore;
          yield* txStore.upsert(makeTx("submitted"));
        })
      );
      await flush();
    });

    await act(async () => {
      await runtimeRef.current?.runPromise(
        Effect.gen(function* () {
          const txStore = yield* TxStore;
          yield* txStore.upsert(makeTx("mined"));
        })
      );
      await flush();
    });

    expect(counts).toContain(0);
    expect(counts).toContain(1);
    expect(counts.at(-1)).toBe(0);
    cleanup();
  });

  it("useTxStoreChanges emits upsert and delete events", async () => {
    const runtimeRef: { current: ReturnType<typeof useEffectEvmRuntime> | null } = {
      current: null,
    };
    const changes: Array<string | null> = [];

    const Probe = (): null => {
      const runtime = useEffectEvmRuntime();
      const change = useTxStoreChanges();

      React.useEffect(() => {
        runtimeRef.current = runtime;
      }, [runtime]);

      React.useEffect(() => {
        changes.push(change?._tag ?? null);
      }, [change]);

      return null;
    };

    const { cleanup } = render(
      React.createElement(EffectEvmProviderSync, {
        children: React.createElement(Probe),
        layer: InMemoryTxStoreLive,
      })
    );

    await act(async () => {
      await flush();
      await flush();
    });

    await act(async () => {
      await runtimeRef.current?.runPromise(
        Effect.gen(function* () {
          const txStore = yield* TxStore;
          yield* txStore.upsert(makeTx("submitted"));
        })
      );
      await flush();
    });

    await act(async () => {
      await runtimeRef.current?.runPromise(
        Effect.gen(function* () {
          const txStore = yield* TxStore;
          yield* txStore.delete(makeTx("submitted").id);
        })
      );
      await flush();
      await flush();
    });

    expect(changes).toContain("upsert");
    expect(changes).toContain("delete");
    cleanup();
  });
});
