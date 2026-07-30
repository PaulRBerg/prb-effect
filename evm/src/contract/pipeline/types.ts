import type { Effect, SubscriptionRef } from "effect";
import type { Abi, Address, Hash, Hex, TransactionReceipt } from "viem";
import type {
  ClientNotFoundError,
  ContractReadError,
  ContractWriteError,
  EventDecodeError,
  GasEstimationError,
  InsufficientFundsError,
  ReceiptTimeoutError,
  ResourceExhaustionError,
  SimulationFailedError,
  TransactionSubmissionError,
  TransportError,
  TxFailedError,
  TxReplacedError,
  UserRejectedError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "#src/core/index.js";
import type { DecodedEvent } from "#src/events/index.js";
import type { GasPriceUnavailableError } from "#src/gas/index.js";
import type { TxPolicy, TxState } from "#src/tx/index.js";
import type { ContractEventName, ContractFunctionName, WriteParams } from "#src/types/index.js";

export type PreflightMode = "strict" | "best-effort" | "none";

export type PreflightConfig = {
  readonly mode?: PreflightMode;
};

export type WriteAndTrackParams<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
> = WriteParams<TAbi, TFunctionName> & {
  policy?: TxPolicy;
  preflight?: PreflightConfig;
};

export type WriteAndTrackResult<TAbi extends Abi> = {
  hash: Hash;
  receipt: TransactionReceipt;
  events: DecodedEvent<TAbi, ContractEventName<TAbi>>[];
};

export type WriteAndTrackTerminal<TAbi extends Abi> =
  | ({ readonly _tag: "success" } & WriteAndTrackResult<TAbi>)
  | {
      readonly _tag: "queued";
      readonly reference?: string;
      readonly reason?: string;
      readonly details?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly _tag: "cancelled";
      readonly reference?: string;
      readonly reason?: string;
      readonly details?: Readonly<Record<string, unknown>>;
    };

export type WriteAndTrackActions = {
  readonly speedup: (
    policy?: TxPolicy
  ) => Effect.Effect<
    Hash,
    TxFailedError | WalletNotConnectedError | ClientNotFoundError | GasPriceUnavailableError | Error
  >;
  readonly cancel: (
    policy?: TxPolicy
  ) => Effect.Effect<
    Hash,
    TxFailedError | WalletNotConnectedError | ClientNotFoundError | GasPriceUnavailableError | Error
  >;
};

export type WriteAndTrackExecution<TAbi extends Abi> = {
  stateRef: SubscriptionRef.SubscriptionRef<TxState>;
  actions: WriteAndTrackActions;
  terminal: Effect.Effect<WriteAndTrackTerminal<TAbi>, WriteAndTrackError>;
};

export type WriteAndTrackError =
  | SimulationFailedError
  | ContractReadError
  | GasEstimationError
  | ContractWriteError
  | InsufficientFundsError
  | ResourceExhaustionError
  | TransactionSubmissionError
  | UserRejectedError
  | GasPriceUnavailableError
  | TxFailedError
  | TxReplacedError
  | ReceiptTimeoutError
  | ClientNotFoundError
  | TransportError
  | WalletNotConnectedError
  | WrongNetworkError
  | EventDecodeError;

/**
 * Hooks for core pipeline stages.
 * All hooks are optional and default to no-ops.
 */
export type PipelineHooks = {
  /** Called when simulation begins */
  readonly onSimulating?: () => Effect.Effect<void>;
  /** Called after gas estimation with the estimated values */
  readonly onEstimated?: (gas: bigint, nonce: number | bigint) => Effect.Effect<void>;
  /** Called when transaction signing begins */
  readonly onSigning?: () => Effect.Effect<void>;
  /** Called after transaction is submitted with the hash */
  readonly onSubmitted?: (hash: Hash) => Effect.Effect<void>;
  /** Called when a replacement transaction is detected */
  readonly onReplaced?: (oldHash: Hash, newHash: Hash, reason: string) => Effect.Effect<void>;
  /** Called when transaction is mined */
  readonly onMined?: (receipt: TransactionReceipt) => Effect.Effect<void>;
};

/**
 * Internal type for nonce reservation result
 */
export type NonceReservation = {
  readonly nonce: number | bigint;
  readonly reserved: boolean;
  readonly markSubmitted: () => Effect.Effect<void>;
};

/**
 * Internal type for prepared transaction overrides
 */
export type PreparedOverrides = {
  readonly type?: "legacy" | "eip1559" | "eip2930" | "eip4844" | "eip7702";
  readonly gas?: bigint;
  readonly nonce: number | bigint;
  readonly gasPrice?: bigint;
  readonly maxFeePerGas?: bigint;
  readonly maxPriorityFeePerGas?: bigint;
  readonly accessList?: readonly {
    address: Address;
    storageKeys: readonly Hex[];
  }[];
};

/**
 * Result from the prepare phase
 */
export type PrepareResult = {
  readonly baseOverrides: PreparedOverrides;
  readonly finalGas?: bigint;
  readonly txPreview: TxState["tx"];
};
