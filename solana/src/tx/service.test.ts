import { describe, expect, it } from "@effect/vitest";
import type { Instruction } from "@solana/kit";
import type { Transaction, TransactionWithLifetime } from "@solana/transactions";
import bs58 from "bs58";
import { Effect } from "effect";
import { COMPUTE_BUDGET_PROGRAM_ADDRESS, SYSTEM_PROGRAM_ADDRESS } from "@/src/constants/index.js";
import {
  makeEffectSolanaTestLayer,
  makeMockRpc,
  TEST_SIGNATURE,
  TEST_WALLET,
} from "@/src/testing-kit/index.js";
import { TransactionService } from "@/src/tx/index.js";

const TEST_SIGNATURE_2 =
  "6VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Solana RPC types use branded types that can't be constructed from literals
const makeRpc = () =>
  makeMockRpc({
    getLatestBlockhash: (() => ({
      send: async () => ({
        context: { slot: 0n },
        value: {
          blockhash: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
          lastValidBlockHeight: 1000n,
        },
      }),
    })) as any,
    getSignatureStatuses: (() => ({
      send: async () => ({
        context: { slot: 0n },
        value: [
          {
            confirmationStatus: "confirmed",
            confirmations: 1n,
            err: null,
            slot: 123n,
            status: { Ok: null },
          },
        ],
      }),
    })) as any,
    sendTransaction: (() => ({
      send: async () => "mock-signature",
    })) as any,
  });

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
            signAllTransactions: <T extends Transaction & TransactionWithLifetime>(
              txs: readonly T[]
            ) =>
              Effect.succeed(
                txs.map((tx, index) => {
                  const signature = index === 0 ? TEST_SIGNATURE : TEST_SIGNATURE_2;
                  const signatureBytes = bs58.decode(signature);
                  return {
                    ...tx,
                    signatures: Object.fromEntries(
                      Object.keys(tx.signatures).map((address) => [address, signatureBytes])
                    ),
                  } as T;
                }) as readonly T[]
              ),
          },
        })
      )
    )
  );
});
