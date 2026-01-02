import { Array as Arr, Effect, Order, Ref } from "effect";
import type { Address } from "viem";

type NonceState = {
  confirmed: Map<string, bigint>;
  pending: Map<string, Set<bigint>>;
};

const makeKey = (chainId: number, address: Address): string =>
  `${chainId}:${address.toLowerCase()}`;

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
      Ref.update(stateRef, (state) => {
        const key = makeKey(chainId, address);
        const pending = state.pending.get(key) ?? new Set();
        pending.add(nonce);
        state.pending.set(key, pending);
        return state;
      });

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

        pending.add(nextNonce);
        state.pending.set(key, pending);
        return [nextNonce, state] as const;
      });

    const release = (chainId: number, address: Address, nonce: bigint): Effect.Effect<void> =>
      Ref.update(stateRef, (state) => {
        const key = makeKey(chainId, address);
        const pending = state.pending.get(key);
        if (pending) {
          pending.delete(nonce);
          if (pending.size === 0) {
            state.pending.delete(key);
          }
        }
        return state;
      });

    const confirm = (chainId: number, address: Address, nonce: bigint): Effect.Effect<void> =>
      Ref.update(stateRef, (state) => {
        const key = makeKey(chainId, address);
        // Remove from pending
        const pending = state.pending.get(key);
        if (pending) {
          pending.delete(nonce);
          if (pending.size === 0) {
            state.pending.delete(key);
          }
        }
        // Update confirmed
        const current = state.confirmed.get(key) ?? 0n;
        if (nonce >= current) {
          state.confirmed.set(key, nonce + 1n);
        }
        return state;
      });

    const setConfirmed = (chainId: number, address: Address, nonce: bigint): Effect.Effect<void> =>
      Ref.update(stateRef, (state) => {
        const key = makeKey(chainId, address);
        state.confirmed.set(key, nonce);
        return state;
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

        const sorted = Arr.sort(pending, Order.bigint);
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
