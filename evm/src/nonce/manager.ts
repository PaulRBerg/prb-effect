import { Array as Arr, Effect, Order, Ref } from "effect";
import type { Address } from "viem";

type NonceState = {
  confirmed: Map<string, bigint>;
  pending: Map<string, Set<bigint>>;
};

const makeKey = (chainId: number, address: Address): string =>
  `${chainId}:${address.toLowerCase()}`;

/** Immutably add a nonce to the pending set for the given key */
function addToPending(state: NonceState, key: string, nonce: bigint): NonceState {
  const newPendingSet = new Set(state.pending.get(key));
  newPendingSet.add(nonce);
  const newPending = new Map(state.pending);
  newPending.set(key, newPendingSet);
  return { confirmed: state.confirmed, pending: newPending };
}

/** Immutably remove a nonce from the pending set for the given key */
function removeFromPending(state: NonceState, key: string, nonce: bigint): NonceState {
  const existing = state.pending.get(key);
  if (!existing) {
    return state;
  }
  const newPendingSet = new Set(existing);
  newPendingSet.delete(nonce);
  const newPending = new Map(state.pending);
  if (newPendingSet.size === 0) {
    newPending.delete(key);
  } else {
    newPending.set(key, newPendingSet);
  }
  return { confirmed: state.confirmed, pending: newPending };
}

export const makeNonceManager = (): Effect.Effect<
  {
    confirm: (chainId: number, address: Address, nonce: bigint) => Effect.Effect<void>;
    getConfirmed: (chainId: number, address: Address) => Effect.Effect<bigint | undefined>;
    getGaps: (chainId: number, address: Address) => Effect.Effect<bigint[]>;
    getPending: (chainId: number, address: Address) => Effect.Effect<Set<bigint>>;
    release: (chainId: number, address: Address, nonce: bigint) => Effect.Effect<void>;
    reserveNext: (chainId: number, address: Address, startNonce: bigint) => Effect.Effect<bigint>;
    reserve: (chainId: number, address: Address, nonce: bigint) => Effect.Effect<void>;
    setConfirmed: (chainId: number, address: Address, nonce: bigint) => Effect.Effect<void>;
  },
  never
> =>
  Effect.gen(function* () {
    const stateRef = yield* Ref.make<NonceState>({
      confirmed: new Map(),
      pending: new Map(),
    });

    const reserve = (chainId: number, address: Address, nonce: bigint): Effect.Effect<void> =>
      Ref.update(stateRef, (state) => addToPending(state, makeKey(chainId, address), nonce));

    const reserveNext = (
      chainId: number,
      address: Address,
      startNonce: bigint
    ): Effect.Effect<bigint> =>
      Ref.modify(stateRef, (state) => {
        const key = makeKey(chainId, address);
        const pending = state.pending.get(key) ?? new Set<bigint>();
        const confirmed = state.confirmed.get(key) ?? 0n;

        let nextNonce = startNonce > confirmed ? startNonce : confirmed;
        while (pending.has(nextNonce)) {
          nextNonce += 1n;
        }

        return [nextNonce, addToPending(state, key, nextNonce)] as const;
      });

    const release = (chainId: number, address: Address, nonce: bigint): Effect.Effect<void> =>
      Ref.update(stateRef, (state) => removeFromPending(state, makeKey(chainId, address), nonce));

    const confirm = (chainId: number, address: Address, nonce: bigint): Effect.Effect<void> =>
      Ref.update(stateRef, (state) => {
        const key = makeKey(chainId, address);
        const withRemoved = removeFromPending(state, key, nonce);
        const current = state.confirmed.get(key) ?? 0n;
        if (nonce < current) {
          return withRemoved;
        }
        const newConfirmed = new Map(state.confirmed);
        newConfirmed.set(key, nonce + 1n);
        return { confirmed: newConfirmed, pending: withRemoved.pending };
      });

    const setConfirmed = (chainId: number, address: Address, nonce: bigint): Effect.Effect<void> =>
      Ref.update(stateRef, (state) => {
        const key = makeKey(chainId, address);
        const newConfirmed = new Map(state.confirmed);
        newConfirmed.set(key, nonce);
        return { confirmed: newConfirmed, pending: state.pending };
      });

    const getConfirmed = (chainId: number, address: Address): Effect.Effect<bigint | undefined> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const key = makeKey(chainId, address);
        return state.confirmed.get(key);
      });

    const getPending = (chainId: number, address: Address): Effect.Effect<Set<bigint>> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const key = makeKey(chainId, address);
        const pending = state.pending.get(key);
        return pending ? new Set(pending) : new Set();
      });

    const getGaps = (chainId: number, address: Address): Effect.Effect<bigint[]> =>
      Effect.gen(function* () {
        const state = yield* Ref.get(stateRef);
        const key = makeKey(chainId, address);
        const pending = state.pending.get(key);
        const confirmed = state.confirmed.get(key) ?? 0n;

        if (!pending || pending.size === 0) {
          return [];
        }

        const sorted = Arr.sort(pending, Order.BigInt);
        const gaps: bigint[] = [];
        let expected = confirmed;

        for (const nonce of sorted) {
          while (expected < nonce) {
            gaps.push(expected);
            expected += 1n;
          }
          expected = nonce + 1n;
        }

        return gaps;
      });

    return {
      confirm,
      getConfirmed,
      getGaps,
      getPending,
      release,
      reserve,
      reserveNext,
      setConfirmed,
    };
  });
