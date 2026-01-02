/**
 * Shared test fixtures for web3.js compatibility tests.
 *
 * @module
 * @internal
 */

import {
  Keypair,
  Transaction as LegacyTransaction,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";

/**
 * Deterministic test keypair for signing transactions.
 */
export const TEST_KEYPAIR = Keypair.fromSeed(
  new Uint8Array([
    1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
    27, 28, 29, 30, 31, 32,
  ])
);

/**
 * Creates a basic legacy Transaction with a single instruction.
 *
 * @returns A Legacy Transaction ready for testing
 *
 * @example
 * ```typescript
 * const tx = createLegacyTransaction();
 * const kitTx = fromWeb3Transaction(tx);
 * ```
 */
export function createLegacyTransaction(): LegacyTransaction {
  const tx = new LegacyTransaction();
  tx.add(
    new TransactionInstruction({
      data: Buffer.from([0, 0, 0, 0]),
      keys: [],
      programId: SystemProgram.programId,
    })
  );
  tx.recentBlockhash = "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC";
  tx.feePayer = new PublicKey("11111111111111111111111111111111");
  return tx;
}

/**
 * Creates a VersionedTransaction with a v0 message.
 *
 * @returns A VersionedTransaction ready for testing
 *
 * @example
 * ```typescript
 * const versionedTx = createVersionedTransaction();
 * const kitTx = fromWeb3Transaction(versionedTx);
 * ```
 */
export function createVersionedTransaction(): VersionedTransaction {
  const instruction = new TransactionInstruction({
    data: Buffer.from([0, 0, 0, 0]),
    keys: [],
    programId: SystemProgram.programId,
  });

  const messageV0 = new TransactionMessage({
    instructions: [instruction],
    payerKey: TEST_KEYPAIR.publicKey,
    recentBlockhash: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
  }).compileToV0Message();

  return new VersionedTransaction(messageV0);
}
