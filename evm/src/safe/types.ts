import type { Address, Hash, Hex, TransactionReceipt } from "viem";

/** Safe info returned from SDK */
export type SafeInfo = {
  safeAddress: Address;
  chainId: number;
};

/** Transaction to send via Safe */
export type SafeTransaction = {
  to: Address;
  data: Hex;
  value?: bigint; // Converted to string at SDK boundary
};

/** Result from sendTransactions */
export type SafeTxSubmission = {
  safeTxHash: Hash;
  safeAddress: Address;
  chainId: number;
};

/** Result from waitForTransactionReceipt */
export type SafeTxResult = {
  safeTxHash: Hash;
  onchainHash: Hash;
  receipt: TransactionReceipt;
  safeAddress: Address;
  chainId: number;
};

/** Discriminated union for signTypedData result */
export type SignTypedDataResult =
  | { readonly _tag: "Offchain"; readonly messageHash: Hex }
  | { readonly _tag: "Onchain"; readonly safeTxHash: Hash };

/** Off-chain signature result */
export type OffchainSignatureResult = {
  messageHash: Hex;
  signature: Hex;
};

/** Policy for Safe tx waiting (aligns with TxPolicy from src/tx/policy.ts) */
export type SafeWaitPolicy = {
  /** Poll interval for Safe gateway in ms (default: 3000) */
  pollInterval?: number;
  /** Timeout for Safe tx execution in ms (default: 300000 = 5 min) */
  executionTimeout?: number;
  /** Policy passed to TxManager.waitForReceipt */
  receiptPolicy?: {
    receiptTimeout?: number;
    pollingInterval?: number;
  };
};

/** Policy for off-chain signature polling */
export type OffchainSignaturePolicy = {
  /** Poll interval in ms (default: 2000) */
  pollInterval?: number;
  /** Timeout in ms (default: 120000 = 2 min) */
  timeout?: number;
};

/** EIP-712 typed data structure (local definition to avoid SDK import) */
export type EIP712TypedData = {
  domain: {
    name?: string;
    version?: string;
    chainId?: number;
    verifyingContract?: string;
    salt?: string;
  };
  types: Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, unknown>;
  primaryType?: string;
};
