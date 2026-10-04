import { describe, expect, it } from "@effect/vitest";
import { Deferred, Effect, Fiber, Layer, Result } from "effect";
import type { TransactionReceipt } from "viem";
import { ContractReaderLive, ContractWriter } from "#src/contract/index.js";
import {
  ClientNotFoundError,
  ReceiptTimeoutError,
  SimulationFailedError,
  TxFailedError,
  TxReplacedError,
} from "#src/core/index.js";
import {
  Erc20AllowanceService,
  Erc20AllowanceServiceLive,
  Erc20NoOutputAllowanceService,
  Erc20NoOutputAllowanceServiceLive,
} from "#src/erc20/index.js";
import {
  makeMockPublicClientLayer,
  makeTestReceipt,
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CHAIN_ID,
  TEST_TX_HASH,
} from "#src/testing-kit/index.js";
import type { TxManagerShape } from "#src/tx/index.js";
import { TxManager } from "#src/tx/index.js";

const APPROVE_HASH = `0x${"ab".repeat(32)}` as const;
const PARAMS = {
  account: TEST_ADDRESS,
  chainId: TEST_CHAIN_ID,
  required: 5n,
  spender: TEST_ADDRESS_2,
  tokenAddress: TEST_ADDRESS,
};

function makeDeps(receipt: ReturnType<TxManagerShape["waitForReceipt"]>) {
  let resetMined = false;
  const writes: unknown[] = [];
  const waits: Array<{ chainId: number; hash: string }> = [];
  const deps = Layer.mergeAll(
    ContractReaderLive.pipe(
      Layer.provide(makeMockPublicClientLayer({ readContract: async () => 1n }))
    ),
    Layer.succeed(ContractWriter, {
      estimateGas: () => Effect.die(new Error("unused")),
      simulate: (params) => {
        // The generic writer erases the concrete ERC-20 argument tuple at this test seam.
        const amount = (params.args as readonly unknown[] | undefined)?.[1];
        return Effect.suspend(() =>
          amount !== 0n && !resetMined
            ? Effect.fail(
                new SimulationFailedError({
                  address: TEST_ADDRESS,
                  functionName: "approve",
                  message: "nonzero allowance must be reset first",
                  phase: "simulate",
                })
              )
            : Effect.succeed({ request: {}, result: true })
        );
      },
      write: (params) =>
        Effect.sync(() => {
          const amount = (params.args as readonly unknown[] | undefined)?.[1];
          writes.push(amount);
          return amount === 0n ? TEST_TX_HASH : APPROVE_HASH;
        }),
    }),
    Layer.succeed(TxManager, {
      getConfirmations: () => Effect.die(new Error("unused")),
      track: () => Effect.die(new Error("unused")),
      waitForReceipt: (chainId, hash) =>
        Effect.gen(function* () {
          waits.push({ chainId, hash });
          const result = yield* receipt;
          resetMined = result.status === "success";
          return result;
        }),
    })
  );
  return {
    layer: Layer.provide(
      Layer.mergeAll(Erc20AllowanceServiceLive, Erc20NoOutputAllowanceServiceLive),
      deps
    ),
    waits,
    writes,
  };
}

for (const Service of [Erc20AllowanceService, Erc20NoOutputAllowanceService]) {
  describe(`${Service.key} zero-first reset`, () => {
    it.effect("mines the reset before simulating and broadcasting the final approval", () => {
      const deps = makeDeps(Effect.succeed(makeTestReceipt()));
      return Effect.gen(function* () {
        const service = yield* Service;
        const result = yield* service.ensureAllowance(PARAMS);
        expect(result).toEqual({
          approveAmount: 5n,
          currentAllowance: 1n,
          hashes: [TEST_TX_HASH, APPROVE_HASH],
          mode: "zero-first",
          status: "approved",
        });
        expect(deps.writes).toEqual([0n, 5n]);
        expect(deps.waits).toEqual([{ chainId: TEST_CHAIN_ID, hash: TEST_TX_HASH }]);
      }).pipe(Effect.provide(deps.layer));
    });

    it.effect("does not request the final approval after a reverted reset", () => {
      const deps = makeDeps(Effect.succeed(makeTestReceipt({ status: "reverted" })));
      return Effect.gen(function* () {
        const service = yield* Service;
        const result = yield* service.ensureAllowance(PARAMS).pipe(Effect.result);
        expect(result).toMatchObject({
          _tag: "Failure",
          failure: { _tag: "TxFailedError", hash: TEST_TX_HASH },
        });
        expect(deps.writes).toEqual([0n]);
      }).pipe(Effect.provide(deps.layer));
    });

    it.effect.each([
      new ReceiptTimeoutError({ hash: TEST_TX_HASH, message: "timeout", timeout: 1 }),
      new TxFailedError({ hash: TEST_TX_HASH, message: "receipt lookup failed" }),
      new TxReplacedError({
        message: "reset cancelled",
        newHash: APPROVE_HASH,
        oldHash: TEST_TX_HASH,
        reason: "cancelled",
      }),
      new ClientNotFoundError({ chainId: TEST_CHAIN_ID, message: "client missing" }),
    ])("preserves receipt failure $_tag without another approval", (failure) => {
      const deps = makeDeps(Effect.fail(failure));
      return Effect.gen(function* () {
        const service = yield* Service;
        const result = yield* service.ensureAllowance(PARAMS).pipe(Effect.result);
        expect(result).toEqual(Result.fail(failure));
        expect(deps.writes).toEqual([0n]);
      }).pipe(Effect.provide(deps.layer));
    });

    it.effect(
      "does not broadcast the final approval if interrupted while the reset is pending",
      () =>
        Effect.gen(function* () {
          const started = yield* Deferred.make<void>();
          const gate = yield* Deferred.make<TransactionReceipt>();
          const deps = makeDeps(
            Deferred.succeed(started, undefined).pipe(Effect.andThen(Deferred.await(gate)))
          );
          const fiber = yield* Effect.gen(function* () {
            const service = yield* Service;
            return yield* service.ensureAllowance(PARAMS);
          }).pipe(Effect.provide(deps.layer), Effect.forkScoped);

          yield* Deferred.await(started);
          expect(deps.writes).toEqual([0n]);
          yield* Fiber.interrupt(fiber);
          yield* Deferred.succeed(gate, makeTestReceipt());
          expect(deps.writes).toEqual([0n]);
        })
    );
  });
}
