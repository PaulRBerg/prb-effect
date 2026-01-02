import type { Transaction, TransactionWithLifetime } from "@solana/transactions";
import { getTransactionDecoder, getTransactionEncoder } from "@solana/transactions";

// Lazy initialization for encoder/decoder
let _encoder: ReturnType<typeof getTransactionEncoder> | null = null;
let _decoder: ReturnType<typeof getTransactionDecoder> | null = null;

function getEncoder() {
  if (_encoder === null) {
    _encoder = getTransactionEncoder();
  }
  return _encoder;
}

function getDecoder() {
  if (_decoder === null) {
    _decoder = getTransactionDecoder();
  }
  return _decoder;
}

/**
 * Detect if a transaction is versioned by checking the first byte.
 * Versioned transactions have bit 7 set (0x80).
 *
 * @internal
 */
function isVersionedMessage(messageBytes: Uint8Array): boolean {
  // biome-ignore lint/suspicious/noBitwiseOperators: Checking version bit in transaction message
  return (messageBytes[0] & 0x80) !== 0;
}

/**
 * Convert a @solana/kit transaction to a @solana/web3.js Transaction or VersionedTransaction.
 *
 * Uses wire-format bytes as the interchange format. Dynamically imports @solana/web3.js
 * for tree-shaking when legacy compatibility is not needed.
 *
 * @param tx - Transaction from @solana/kit
 * @returns Promise of Transaction or VersionedTransaction from @solana/web3.js
 *
 * @category Compatibility
 *
 * @example
 * ```typescript
 * import { toWeb3Transaction } from "@prb/effect-solana/compat";
 *
 * const kitTx: Transaction & TransactionWithLifetime = /* ... *\/;
 * const legacyTx = await toWeb3Transaction(kitTx);
 * // => Transaction or VersionedTransaction instance
 * ```
 */
export async function toWeb3Transaction(
  tx: Transaction & TransactionWithLifetime
): Promise<unknown> {
  const wire = getEncoder().encode(tx);

  let LegacyTransaction: { from(bytes: Uint8Array): unknown };
  let VersionedTransaction: { deserialize(bytes: Uint8Array): unknown };

  try {
    const web3Module = await import("@solana/web3.js");
    LegacyTransaction = web3Module.Transaction;
    VersionedTransaction = web3Module.VersionedTransaction;
  } catch (error) {
    throw new Error(
      "@solana/web3.js is required for legacy compatibility. Install it as a peer dependency.",
      { cause: error }
    );
  }

  // Convert ReadonlyUint8Array to Uint8Array for web3.js compatibility
  const wireBytes = new Uint8Array(wire);

  return isVersionedMessage(wireBytes)
    ? VersionedTransaction.deserialize(wireBytes)
    : LegacyTransaction.from(wireBytes);
}

/**
 * Convert a @solana/web3.js Transaction or VersionedTransaction to a @solana/kit transaction.
 *
 * Uses wire-format bytes as the interchange format.
 *
 * @param tx - Transaction or VersionedTransaction from @solana/web3.js
 * @returns Transaction from @solana/kit
 *
 * @category Compatibility
 *
 * @example
 * ```typescript
 * import { fromWeb3Transaction } from "@prb/effect-solana/compat";
 * import { Transaction } from "@solana/web3.js";
 *
 * const legacyTx = new Transaction();
 * const kitTx = fromWeb3Transaction(legacyTx);
 * // => Transaction & TransactionWithLifetime
 * ```
 */
export function fromWeb3Transaction(tx: {
  serialize(opts: { requireAllSignatures: boolean; verifySignatures: boolean }): Uint8Array;
}): Transaction & TransactionWithLifetime {
  const wire = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

  try {
    return getDecoder().decode(wire) as Transaction & TransactionWithLifetime;
  } catch (error) {
    throw new Error("Failed to decode transaction from web3.js format", { cause: error });
  }
}
