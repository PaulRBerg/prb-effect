import type { Effect, Option } from "effect";
import { Context } from "effect";
import type { Hash, Hex } from "viem";
import type {
  ClientNotFoundError,
  ReceiptTimeoutError,
  TransactionFailedError,
} from "@/src/core/errors/index.js";
import type {
  OffchainSignatureTimeoutError,
  SafeInfoUnavailableError,
  SafeSettingsError,
  SafeTxExecutionTimeoutError,
  SafeTxLookupError,
  SafeTxSubmissionError,
  SignTypedDataError,
} from "./errors.js";
import type {
  EIP712TypedData,
  OffchainSignaturePolicy,
  OffchainSignatureResult,
  SafeInfo,
  SafeTransaction,
  SafeTxResult,
  SafeTxSubmission,
  SafeWaitPolicy,
  SignTypedDataResult,
} from "./types.js";

export type SafeAppsServiceShape = {
  /** Get Safe info (cached after first call) */
  readonly getInfo: () => Effect.Effect<SafeInfo, SafeInfoUnavailableError>;

  /** Send transactions to Safe for execution */
  readonly sendTransactions: (
    txs: readonly SafeTransaction[],
    params?: { safeTxGas?: number }
  ) => Effect.Effect<SafeTxSubmission, SafeTxSubmissionError>;

  /** Get Safe transaction details by safeTxHash */
  readonly getTransaction: (
    safeTxHash: Hash
  ) => Effect.Effect<{ txHash: Option.Option<Hash>; status: string }, SafeTxLookupError>;

  /** Wait for Safe tx to execute and return receipt */
  readonly waitForTransactionReceipt: (
    safeTxHash: Hash,
    policy?: SafeWaitPolicy
  ) => Effect.Effect<
    SafeTxResult,
    | SafeTxExecutionTimeoutError
    | SafeTxLookupError
    | TransactionFailedError
    | ReceiptTimeoutError
    | ClientNotFoundError
  >;

  /** Sign typed data (returns discriminated union based on Safe settings) */
  readonly signTypedData: (
    typedData: EIP712TypedData
  ) => Effect.Effect<SignTypedDataResult, SignTypedDataError>;

  /** Get off-chain signature (returns Option.none if not yet available) */
  readonly getOffchainSignature: (
    messageHash: Hex
  ) => Effect.Effect<Option.Option<Hex>, SafeTxLookupError>;

  /** Poll for off-chain signature until available or timeout */
  readonly pollOffchainSignature: (
    messageHash: Hex,
    policy?: OffchainSignaturePolicy
  ) => Effect.Effect<OffchainSignatureResult, OffchainSignatureTimeoutError | SafeTxLookupError>;

  /** Enable off-chain signing mode */
  readonly enableOffchainSigning: () => Effect.Effect<void, SafeSettingsError>;
};

export class SafeAppsService extends Context.Tag("ew3/SafeApps")<
  SafeAppsService,
  SafeAppsServiceShape
>() {}
