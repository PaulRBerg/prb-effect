import type { Address, Hash, Hex, TransactionReceipt } from "viem";

/** Safe multisig info returned from SDK */
export type SafeMultisigInfo = {
  chainId: number;
  safeAddress: Address;
};

/** Tx to send via Safe multisig */
export type SafeMultisigTx = {
  data: Hex;
  to: Address;
  value?: bigint; // Converted to string at SDK boundary
};

/** Result from sendTxs */
export type SafeMultisigTxSubmission = {
  chainId: number;
  safeAddress: Address;
  safeTxHash: Hash;
};

/** Result from waitForTxReceipt */
export type SafeMultisigTxResult = {
  chainId: number;
  onchainHash: Hash;
  receipt: TransactionReceipt;
  safeAddress: Address;
  safeTxHash: Hash;
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
  /** Timeout for Safe tx execution in ms (default: 300000 = 5 min) */
  executionTimeout?: number;
  /** Poll interval for Safe gateway in ms (default: 3000) */
  pollInterval?: number;
  /** Policy passed to TxManager.waitForReceipt */
  receiptPolicy?: {
    pollingInterval?: number;
    receiptTimeout?: number;
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
    chainId?: number;
    name?: string;
    salt?: string;
    verifyingContract?: string;
    version?: string;
  };
  message: Record<string, unknown>;
  primaryType?: string;
  types: Record<string, Array<{ name: string; type: string }>>;
};
