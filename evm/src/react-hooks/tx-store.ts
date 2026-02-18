"use client";

import { Effect } from "effect";
import { useStreamEffect } from "#src/integrations/react-hooks/primitives.js";
import type { PersistedTx, TxStoreChange } from "#src/platform/browser/tx-store/index.js";
import { TxStore } from "#src/platform/browser/tx-store/index.js";

/**
 * Subscribe to all TxStore changes (upsert/delete).
 * Returns the latest change, or `null` before the first event arrives.
 */
export function useTxStoreChanges(): TxStoreChange | null {
  const state = useStreamEffect(
    () =>
      Effect.gen(function* () {
        const txStore = yield* TxStore;
        return txStore.changes;
      }),
    [],
    { initial: null }
  );
  return state.value ?? null;
}

/**
 * Subscribe to all in-flight transactions from TxStore.
 * Emits on every upsert/delete that changes in-flight membership.
 */
export function useInFlightTxs(): readonly PersistedTx[] {
  const state = useStreamEffect(
    () =>
      Effect.gen(function* () {
        const txStore = yield* TxStore;
        return txStore.watchInFlight();
      }),
    [],
    { initial: [] }
  );
  return state.value ?? [];
}
