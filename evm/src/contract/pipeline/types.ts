import type { Effect } from "effect";
import type { Abi, Address, Hash, Hex, TransactionReceipt } from "viem";
import type {
  ClientNotFoundError,
  ContractReadError,
  ContractWriteError,
  EventDecodeError,
  GasEstimationError,
  InsufficientFundsError,
  ReceiptTimeoutError,
  SimulationFailedError,
  TransportError,
  TxFailedError,
  TxReplacedError,
  UserRejectedError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "@/src/core/index.js";
import type { DecodedEvent } from "@/src/events/index.js";
import type { GasPriceUnavailableError } from "@/src/gas/index.js";
import type { TxPolicy, TxState } from "@/src/tx/index.js";
import type { ContractEventName, ContractFunctionName, WriteParams } from "@/src/types/index.js";

export type WriteAndTrackParams<
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
> = WriteParams<TAbi, TFunctionName> & {
  policy?: TxPolicy;
};

export type WriteAndTrackResult<TAbi extends Abi> = {
  hash: Hash;
  receipt: TransactionReceipt;
  events: DecodedEvent<TAbi, ContractEventName<TAbi>>[];
};

export type WriteAndTrackError =
  | SimulationFailedError
  | ContractReadError
  | GasEstimationError
  | ContractWriteError
  | InsufficientFundsError
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
  readonly gas: bigint;
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
  readonly finalGas: bigint;
  readonly txPreview: TxState["tx"];
};
