import type { Effect } from "effect";
import type { Address, Hash } from "viem";
import type {
  ApprovalCheckError,
  ApprovalError,
  ClientNotFoundError,
  ContractWriteError,
  InsufficientFundsError,
  UserRejectedError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "#src/core/index.js";

export type CheckAllowanceParams = {
  readonly chainId: number;
  readonly owner: Address;
  readonly spender: Address;
  readonly tokenAddress: Address;
};

export type ApproveParams = {
  readonly account: Address;
  readonly amount: bigint;
  readonly chainId: number;
  readonly spender: Address;
  readonly tokenAddress: Address;
};

export type EnsureAllowanceParams = {
  readonly account: Address;
  readonly chainId: number;
  readonly required: bigint;
  readonly spender: Address;
  readonly tokenAddress: Address;
  /**
   * Amount to approve if allowance is insufficient.
   *
   * If omitted, defaults to `required`.
   */
  readonly approveAmount?: bigint | undefined;
  /**
   * If `true` (default), when current allowance is non-zero and a direct approve fails,
   * retry with `approve(0)` then `approve(approveAmount)`.
   */
  readonly zeroFirst?: boolean | undefined;
};

export type EnsureAllowanceResult =
  | {
      readonly status: "already-sufficient";
      readonly currentAllowance: bigint;
    }
  | {
      readonly status: "approved";
      readonly approveAmount: bigint;
      readonly currentAllowance: bigint;
      readonly hashes: readonly Hash[];
      readonly mode: "direct" | "zero-first";
    };

export type Erc20AllowanceServiceShape = {
  readonly checkAllowance: (
    params: CheckAllowanceParams
  ) => Effect.Effect<bigint, ApprovalCheckError | ClientNotFoundError>;

  readonly approve: (
    params: ApproveParams
  ) => Effect.Effect<
    Hash,
    | ApprovalError
    | ClientNotFoundError
    | ContractWriteError
    | InsufficientFundsError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
  >;

  readonly ensureAllowance: (
    params: EnsureAllowanceParams
  ) => Effect.Effect<
    EnsureAllowanceResult,
    | ApprovalCheckError
    | ApprovalError
    | ClientNotFoundError
    | ContractWriteError
    | InsufficientFundsError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
  >;

  /**
   * Maximum approval value recommended by this implementation.
   *
   * For standard tokens this is `uint256.max`; for "bit-96" tokens this is `uint96.max`.
   * The `decimals` parameter is accepted for API symmetry with app-level workflows.
   */
  readonly getMaxAmount: (decimals: number) => bigint;
};
