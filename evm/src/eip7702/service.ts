import { Context, Effect, Layer } from "effect";
import type { AccessList, Account, Address, Authorization, Hash, Hex } from "viem";
import { encodeFunctionData, erc20Abi } from "viem";
import { prepareAuthorization } from "viem/actions";
import type {
  ClientNotFoundError,
  ReceiptTimeoutError,
  TxFailedError,
  TxReplacedError,
  WrongNetworkError,
} from "#src/core/index.js";
import {
  InsufficientFundsError,
  isInsufficientFunds,
  isResourceExhaustion,
  isUserRejection,
  PublicClientService,
  ResourceExhaustionError,
  UserRejectedError,
  WalletClientService,
  WalletNotConnectedError,
} from "#src/core/index.js";
import type { TxPolicy } from "#src/tx/index.js";
import { defaultPolicy, TxManager } from "#src/tx/index.js";
import type { TxResult } from "#src/types/index.js";
import type { Erc7579ModeCode } from "./erc7579.js";
import {
  ERC7579_MODE_SIMPLE_BATCH,
  encodeErc7579BatchExecutionCalldata,
  encodeErc7579ExecuteCalldata,
} from "./erc7579.js";
import {
  Eip7702AuthorizationPreparationError,
  Eip7702AuthorizationSigningError,
  Eip7702SendTxError,
} from "./errors.js";

export type Eip7702Call = {
  readonly to: Address;
  readonly data: Hex;
  readonly value?: bigint | undefined;
};

export type Eip7702AuthorizationExecutor = "self" | Address | Account;

export type Eip7702TxOverrides = {
  readonly accessList?: AccessList | undefined;
  readonly gas?: bigint | undefined;
  readonly maxFeePerGas?: bigint | undefined;
  readonly maxPriorityFeePerGas?: bigint | undefined;
  readonly nonce?: number | undefined;
};

export type DelegateAndExecuteErc7579BatchParams = {
  readonly chainId: number;
  readonly account?: Address | Account | undefined;
  readonly delegation: Address;
  readonly calls: readonly Eip7702Call[];
  readonly mode?: Erc7579ModeCode | undefined;
  readonly tx?: Eip7702TxOverrides | undefined;
};

export type ApproveAndExecuteParams = {
  readonly chainId: number;
  readonly account?: Address | Account | undefined;
  readonly delegation: Address;
  readonly token: Address;
  readonly spender: Address;
  readonly amount: bigint;
  readonly call: Eip7702Call;
  readonly mode?: Erc7579ModeCode | undefined;
  readonly tx?: Eip7702TxOverrides | undefined;
};

export type DelegateAndExecuteResult = TxResult;

function mapSendEip7702TransactionCause(
  chainId: number,
  cause: unknown
): Eip7702SendTxError | InsufficientFundsError | ResourceExhaustionError | UserRejectedError {
  if (isUserRejection(cause)) {
    return new UserRejectedError({
      message: cause instanceof Error ? cause.message : "User rejected the request",
    });
  }

  if (isInsufficientFunds(cause)) {
    return new InsufficientFundsError({
      message: cause instanceof Error ? cause.message : "Insufficient funds for transaction",
    });
  }

  if (isResourceExhaustion(cause)) {
    return new ResourceExhaustionError({
      cause,
      message: "Device ran out of memory during EIP-7702 transaction submission",
    });
  }

  return new Eip7702SendTxError({
    cause,
    chainId,
    message: cause instanceof Error ? cause.message : "Failed to send EIP-7702 transaction",
  });
}

export type Eip7702ServiceShape = {
  readonly prepareAuthorization: (params: {
    readonly chainId: number;
    readonly account: Address | Account;
    readonly contractAddress: Address;
    readonly executor?: Eip7702AuthorizationExecutor | undefined;
  }) => Effect.Effect<
    Authorization<number>,
    Eip7702AuthorizationPreparationError | ClientNotFoundError
  >;

  readonly delegateAndExecuteErc7579Batch: (
    params: DelegateAndExecuteErc7579BatchParams
  ) => Effect.Effect<
    Hash,
    | Eip7702AuthorizationPreparationError
    | Eip7702AuthorizationSigningError
    | Eip7702SendTxError
    | InsufficientFundsError
    | ResourceExhaustionError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
  >;

  readonly delegateAndExecuteErc7579BatchAndWait: (
    params: DelegateAndExecuteErc7579BatchParams & {
      readonly policy?: TxPolicy | undefined;
    }
  ) => Effect.Effect<
    DelegateAndExecuteResult,
    | Eip7702SendTxError
    | Eip7702AuthorizationPreparationError
    | Eip7702AuthorizationSigningError
    | InsufficientFundsError
    | ResourceExhaustionError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
    | ReceiptTimeoutError
    | TxFailedError
    | TxReplacedError
  >;

  readonly approveAndExecute: (
    params: ApproveAndExecuteParams
  ) => Effect.Effect<
    Hash,
    | Eip7702AuthorizationPreparationError
    | Eip7702AuthorizationSigningError
    | Eip7702SendTxError
    | InsufficientFundsError
    | ResourceExhaustionError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
  >;

  readonly approveAndExecuteAndWait: (
    params: ApproveAndExecuteParams & {
      readonly policy?: TxPolicy | undefined;
    }
  ) => Effect.Effect<
    DelegateAndExecuteResult,
    | Eip7702SendTxError
    | Eip7702AuthorizationPreparationError
    | Eip7702AuthorizationSigningError
    | InsufficientFundsError
    | ResourceExhaustionError
    | UserRejectedError
    | WalletNotConnectedError
    | WrongNetworkError
    | ClientNotFoundError
    | ReceiptTimeoutError
    | TxFailedError
    | TxReplacedError
  >;
};

export class Eip7702Service extends Context.Service<Eip7702Service, Eip7702ServiceShape>()(
  "ew3/Eip7702Service"
) {}

const accountAddress = (account: Address | Account): Address =>
  typeof account === "string" ? account : account.address;

const signAuthorizationIfSupported = (
  account: Address | Account,
  authorization: Authorization<number>
): Effect.Effect<Authorization<number>, Eip7702AuthorizationSigningError> => {
  if (typeof account === "string") {
    return Effect.succeed(authorization);
  }
  const signAuthorization = account.signAuthorization;
  if (!signAuthorization) {
    return Effect.succeed(authorization);
  }

  return Effect.tryPromise({
    catch: (cause) =>
      new Eip7702AuthorizationSigningError({
        cause,
        chainId: authorization.chainId,
        message: cause instanceof Error ? cause.message : "Failed to sign EIP-7702 authorization",
      }),
    try: () => signAuthorization(authorization),
  });
};

export const Eip7702ServiceLive = Layer.effect(
  Eip7702Service,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;
    const walletClientService = yield* WalletClientService;
    const txManager = yield* TxManager;

    const prepareAuthorizationEffect = (params: {
      readonly chainId: number;
      readonly account: Address | Account;
      readonly contractAddress: Address;
      readonly executor?: Eip7702AuthorizationExecutor | undefined;
    }) =>
      Effect.gen(function* () {
        const publicClient = yield* publicClientService.get(params.chainId);

        return yield* Effect.tryPromise({
          catch: (cause) =>
            new Eip7702AuthorizationPreparationError({
              cause,
              chainId: params.chainId,
              message:
                cause instanceof Error ? cause.message : "Failed to prepare EIP-7702 authorization",
            }),
          try: (): Promise<Authorization<number>> =>
            prepareAuthorization(publicClient, {
              account: params.account,
              chainId: params.chainId,
              contractAddress: params.contractAddress,
              executor: params.executor ?? "self",
            }) as Promise<Authorization<number>>,
        });
      });

    const prepareAuthorizationWithNonceEffect = (params: {
      readonly chainId: number;
      readonly account: Address | Account;
      readonly contractAddress: Address;
      readonly executor?: Eip7702AuthorizationExecutor | undefined;
      readonly nonce?: number | undefined;
    }) =>
      Effect.gen(function* () {
        const publicClient = yield* publicClientService.get(params.chainId);

        return yield* Effect.tryPromise({
          catch: (cause) =>
            new Eip7702AuthorizationPreparationError({
              cause,
              chainId: params.chainId,
              message:
                cause instanceof Error ? cause.message : "Failed to prepare EIP-7702 authorization",
            }),
          try: (): Promise<Authorization<number>> =>
            prepareAuthorization(publicClient, {
              account: params.account,
              chainId: params.chainId,
              contractAddress: params.contractAddress,
              executor: params.executor ?? "self",
              nonce: params.nonce,
            }) as Promise<Authorization<number>>,
        });
      });

    const delegateAndExecuteBatch = (params: DelegateAndExecuteErc7579BatchParams) =>
      Effect.gen(function* () {
        const walletClient = yield* walletClientService.get(params.chainId);

        const account = params.account ?? walletClient.account;
        if (!account) {
          return yield* Effect.fail(
            new WalletNotConnectedError({
              chainId: params.chainId,
              message: "No active account found. Provide `account` explicitly.",
            })
          );
        }

        const txNonce = params.tx?.nonce;
        const authorizationNonce = txNonce === undefined ? undefined : txNonce + 1;

        const authorization = yield* prepareAuthorizationWithNonceEffect({
          account,
          chainId: params.chainId,
          contractAddress: params.delegation,
          executor: "self",
          nonce: authorizationNonce,
        });

        const authorizationSigned = yield* signAuthorizationIfSupported(account, authorization);

        const executions = params.calls.map((call) => ({
          callData: call.data,
          target: call.to,
          value: call.value ?? 0n,
        }));
        const executionCalldata = encodeErc7579BatchExecutionCalldata(executions);
        const data = encodeErc7579ExecuteCalldata({
          executionCalldata,
          mode: params.mode ?? ERC7579_MODE_SIMPLE_BATCH,
        });

        const to = accountAddress(account);

        return yield* Effect.tryPromise({
          catch: (cause) => mapSendEip7702TransactionCause(params.chainId, cause),
          try: () =>
            walletClient.sendTransaction({
              accessList: params.tx?.accessList,
              account,
              authorizationList: [authorizationSigned],
              chain: walletClient.chain ?? null,
              data,
              gas: params.tx?.gas,
              maxFeePerGas: params.tx?.maxFeePerGas,
              maxPriorityFeePerGas: params.tx?.maxPriorityFeePerGas,
              nonce: txNonce,
              to,
              type: "eip7702",
            }),
        });
      });

    const delegateAndExecuteBatchAndWait = (
      params: DelegateAndExecuteErc7579BatchParams & {
        readonly policy?: TxPolicy | undefined;
      }
    ) =>
      Effect.gen(function* () {
        const policy = params.policy ?? defaultPolicy;
        const hash = yield* delegateAndExecuteBatch(params);
        const receipt = yield* txManager.waitForReceipt(
          params.chainId,
          hash,
          policy.receiptTimeout
        );
        return { hash, receipt } as DelegateAndExecuteResult;
      });

    const approveAndExecute = (params: ApproveAndExecuteParams) => {
      const approveData = encodeFunctionData({
        abi: erc20Abi,
        args: [params.spender, params.amount],
        functionName: "approve",
      });

      return delegateAndExecuteBatch({
        account: params.account,
        calls: [{ data: approveData, to: params.token, value: 0n }, params.call],
        chainId: params.chainId,
        delegation: params.delegation,
        mode: params.mode,
        tx: params.tx,
      });
    };

    const approveAndExecuteAndWait = (
      params: ApproveAndExecuteParams & {
        readonly policy?: TxPolicy | undefined;
      }
    ) =>
      Effect.gen(function* () {
        const policy = params.policy ?? defaultPolicy;
        const hash = yield* approveAndExecute(params);
        const receipt = yield* txManager.waitForReceipt(
          params.chainId,
          hash,
          policy.receiptTimeout
        );
        return { hash, receipt } as DelegateAndExecuteResult;
      });

    return Eip7702Service.of({
      approveAndExecute,
      approveAndExecuteAndWait,
      delegateAndExecuteErc7579Batch: delegateAndExecuteBatch,
      delegateAndExecuteErc7579BatchAndWait: delegateAndExecuteBatchAndWait,
      prepareAuthorization: prepareAuthorizationEffect,
    });
  })
);
