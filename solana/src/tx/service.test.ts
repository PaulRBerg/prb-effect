import { describe, expect, it } from "@effect/vitest";
import type { Transaction, TransactionError } from "@solana/web3.js";
import { Keypair, PublicKey, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Effect } from "effect";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS, SYSTEM_PROGRAM_ADDRESS } from "#src/constants/index.js";
import {
  expectTaggedFailure,
  makeEffectSolanaTestLayer,
  makeMockRpc,
  TEST_SIGNATURE,
} from "#src/testing-kit/index.js";
import { TransactionService } from "#src/tx/index.js";
import type { Address } from "#src/types/index.js";

const TEST_SIGNATURE_2 =
  "6VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

const TEST_BLOCKHASH = "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC";

const makeRpc = () => {
  let sendCalls = 0;
  return makeMockRpc({
    getLatestBlockhash: () =>
      Promise.resolve({
        blockhash: TEST_BLOCKHASH,
        lastValidBlockHeight: 1000,
      }),
    getSignatureStatuses: () =>
      Promise.resolve({
        context: { slot: 0 },
        value: [
          {
            confirmationStatus: "confirmed",
            confirmations: 1,
            err: null,
            slot: 123,
          },
        ],
      }),
    sendRawTransaction: () => {
      sendCalls += 1;
      return Promise.resolve(sendCalls === 1 ? TEST_SIGNATURE : TEST_SIGNATURE_2);
    },
  });
};

const makeInstruction = (): TransactionInstruction =>
  new TransactionInstruction({
    data: Buffer.alloc(0),
    keys: [],
    programId: new PublicKey(SYSTEM_PROGRAM_ADDRESS),
  });

describe("TransactionService (Live)", () => {
  it.effect("build prepends compute budget instructions when configured", () =>
    Effect.gen(function* () {
      const service = yield* TransactionService;
      const tx = yield* service.build([makeInstruction()], {
        computeBudget: { microLamports: 5000, unitLimit: 100_000 },
      });

      expect(tx.instructions.length).toBe(3);
      expect(tx.instructions[0]?.programId.toBase58()).toBe(COMPUTE_BUDGET_PROGRAM_ADDRESS);
      expect(tx.instructions[1]?.programId.toBase58()).toBe(COMPUTE_BUDGET_PROGRAM_ADDRESS);
      expect(tx.instructions[2]?.programId.toBase58()).toBe(SYSTEM_PROGRAM_ADDRESS);
    }).pipe(
      Effect.provide(
        makeEffectSolanaTestLayer({
          rpcService: { getRpc: () => Effect.succeed(makeRpc()) },
        })
      )
    )
  );

  it.effect("confirm succeeds when status appears after blockhash expiry grace starts", () => {
    let statusCalls = 0;
    const rpc = makeMockRpc({
      getBlockHeight: () => Promise.resolve(1001),
      getSignatureStatuses: () => {
        statusCalls += 1;
        return Promise.resolve({
          context: { slot: 0 },
          value:
            statusCalls === 1
              ? [null]
              : [
                  {
                    confirmationStatus: "confirmed",
                    confirmations: 1,
                    err: null,
                    slot: 123,
                  },
                ],
        });
      },
    });

    return Effect.gen(function* () {
      const service = yield* TransactionService;
      const receipt = yield* service.confirm(TEST_SIGNATURE, {
        pollInterval: 0,
        timeout: 1000,
        lifetime: {
          blockhash: TEST_BLOCKHASH,
          expiredStatusGracePeriod: "1 second",
          lastValidBlockHeight: 1000n,
        },
      });

      expect(receipt.signature).toBe(TEST_SIGNATURE);
      expect(statusCalls).toBe(2);
    }).pipe(
      Effect.provide(
        makeEffectSolanaTestLayer({
          rpcService: { getRpc: () => Effect.succeed(rpc) },
        })
      )
    );
  });

  it.effect("confirm fails when signature status contains an on-chain error", () => {
    const transactionError = { InstructionError: [0, "Custom"] } as TransactionError;

    return Effect.gen(function* () {
      const service = yield* TransactionService;
      const exit = yield* Effect.exit(service.confirm(TEST_SIGNATURE, { pollInterval: 0 }));

      expectTaggedFailure(exit, "TransactionFailedError");
    }).pipe(
      Effect.provide(
        makeEffectSolanaTestLayer({
          rpcService: {
            getRpc: () =>
              Effect.succeed(
                makeMockRpc({
                  getSignatureStatuses: () =>
                    Promise.resolve({
                      context: { slot: 0 },
                      value: [
                        {
                          confirmationStatus: "confirmed",
                          confirmations: 1,
                          err: transactionError,
                          slot: 123,
                        },
                      ],
                    }),
                })
              ),
          },
        })
      )
    );
  });

  it.effect("sendAndConfirmBatch returns receipts for each transaction", () => {
    const rpc = makeRpc();
    const signer = Keypair.generate();

    return Effect.gen(function* () {
      const service = yield* TransactionService;
      const receipts = yield* service.sendAndConfirmBatch(
        [{ instructions: [makeInstruction()] }, { instructions: [makeInstruction()] }],
        { confirm: { commitment: "confirmed" } }
      );

      expect(receipts.length).toBe(2);
      expect(receipts[0]?.signature).toBe(TEST_SIGNATURE);
      expect(receipts[1]?.signature).toBe(TEST_SIGNATURE_2);
    }).pipe(
      Effect.provide(
        makeEffectSolanaTestLayer({
          rpcService: { getRpc: () => Effect.succeed(rpc) },
          signerService: {
            address: signer.publicKey.toBase58() as Address,
            signAllTransactions: <T extends Transaction>(txs: readonly T[]) =>
              Effect.sync(
                () =>
                  txs.map((tx) => {
                    tx.sign(signer);
                    return tx;
                  }) as readonly T[]
              ),
          },
        })
      )
    );
  });
});
