import { describe, expect, it } from "@effect/vitest";
import type { Instruction, Rpc, SolanaRpcApi } from "@solana/kit";
import type { Transaction, TransactionWithLifetime } from "@solana/transactions";
import { Effect } from "effect";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS, SYSTEM_PROGRAM_ADDRESS } from "@/src/constants/index.js";
import { makeEffectSolanaTestLayer, TEST_SIGNATURE, TEST_WALLET } from "@/src/testing-kit/index.js";
import { TransactionService } from "@/src/tx/index.js";

const TEST_SIGNATURE_2 =
  "6VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

const makeRpc = (): Rpc<SolanaRpcApi> =>
  ({
    getLatestBlockhash: () => ({
      send: async () => ({
        value: {
          blockhash: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC" as never,
          lastValidBlockHeight: 1000n,
        },
      }),
    }),
    getSignatureStatuses: () => ({
      send: async () => ({
        value: [
          {
            confirmationStatus: "confirmed" as never,
            confirmations: 1,
            err: null,
            slot: 123n,
          },
        ],
      }),
    }),
    sendTransaction: () => ({
      send: async () => "mock-signature",
    }),
  }) as Rpc<SolanaRpcApi>;

const makeInstruction = (): Instruction => ({
  accounts: [],
  data: new Uint8Array(),
  programAddress: SYSTEM_PROGRAM_ADDRESS,
});

describe("TransactionService (Live)", () => {
  it.effect("build prepends compute budget instructions when configured", () =>
    Effect.gen(function* () {
      const service = yield* TransactionService;
      const message = yield* service.build([makeInstruction()], {
        computeBudget: { microLamports: 5000, unitLimit: 100_000 },
      });

      expect(message.instructions.length).toBe(3);
      expect(message.instructions[0]?.programAddress).toBe(COMPUTE_BUDGET_PROGRAM_ADDRESS);
      expect(message.instructions[1]?.programAddress).toBe(COMPUTE_BUDGET_PROGRAM_ADDRESS);
      expect(message.instructions[2]?.programAddress).toBe(SYSTEM_PROGRAM_ADDRESS);
    }).pipe(
      Effect.provide(
        makeEffectSolanaTestLayer({
          rpcService: { getRpc: () => Effect.succeed(makeRpc()) },
        })
      )
    )
  );

  it.effect("sendAndConfirmBatch returns receipts for each transaction", () =>
    Effect.gen(function* () {
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
          rpcService: { getRpc: () => Effect.succeed(makeRpc()) },
          signerService: {
            address: TEST_WALLET,
            signAllTransactions: (txs) =>
              Effect.succeed(
                txs.map((tx, index) => {
                  const signature = index === 0 ? TEST_SIGNATURE : TEST_SIGNATURE_2;
                  return {
                    ...tx,
                    signatures: Object.fromEntries(
                      Object.keys(tx.signatures).map((address) => [address, signature])
                    ),
                  } as Transaction & TransactionWithLifetime;
                })
              ),
          },
        })
      )
    )
  );
});
