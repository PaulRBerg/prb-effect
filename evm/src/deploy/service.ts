import type { Scope, SubscriptionRef } from "effect";
import { Context, Effect, Layer } from "effect";
import type { Abi, Address, ContractConstructorArgs, Hash, Hex, TransactionReceipt } from "viem";
import { getContractAddress } from "viem";
import type {
  ClientNotFoundError,
  ContractWriteError,
  ReceiptTimeoutError,
  TxFailedError,
  TxReplacedError,
  UserRejectedError,
  WrongNetworkError,
} from "@/src/core/index.js";
import {
  PublicClientService,
  WalletClientService,
  WalletNotConnectedError,
} from "@/src/core/index.js";
import {
  BytecodeMismatchError,
  DeploymentError,
  DeploymentRevertedError,
} from "@/src/deploy/index.js";
import type { GasPriceUnavailableError } from "@/src/gas/index.js";
import { GasService } from "@/src/gas/index.js";
import type { TxPolicy, TxState } from "@/src/tx/index.js";
import { defaultPolicy, deriveFeeOverrides, makeTxTracker, TxManager } from "@/src/tx/index.js";

type DeployArgs<TAbi extends Abi> = ContractConstructorArgs<TAbi>;
type DeployArgsField<TAbi extends Abi> =
  readonly [] extends DeployArgs<TAbi>
    ? { args?: DeployArgs<TAbi> | undefined }
    : { args: DeployArgs<TAbi> };

export type DeployResult = {
  hash: Hash;
  address: Address;
  receipt: TransactionReceipt;
  deployedBytecode: Hex;
};

export type DeployServiceShape = {
  readonly deploy: <TAbi extends Abi>(
    params: {
      chainId: number;
      abi: TAbi;
      bytecode: Hex;
      value?: bigint;
      account?: Address;
      gas?: bigint;
    } & DeployArgsField<TAbi>
  ) => Effect.Effect<
    DeployResult,
    | DeploymentError
    | DeploymentRevertedError
    | GasPriceUnavailableError
    | ContractWriteError
    | UserRejectedError
    | ClientNotFoundError
    | WalletNotConnectedError
    | WrongNetworkError
    | ReceiptTimeoutError
    | TxFailedError
    | TxReplacedError
  >;

  readonly deployAndTrack: <TAbi extends Abi>(
    params: {
      chainId: number;
      abi: TAbi;
      bytecode: Hex;
      value?: bigint;
      account?: Address;
      policy?: TxPolicy;
    } & DeployArgsField<TAbi>
  ) => Effect.Effect<
    {
      stateRef: SubscriptionRef.SubscriptionRef<TxState>;
      result: Effect.Effect<
        DeployResult,
        | DeploymentError
        | DeploymentRevertedError
        | GasPriceUnavailableError
        | ContractWriteError
        | UserRejectedError
        | ClientNotFoundError
        | WalletNotConnectedError
        | WrongNetworkError
        | ReceiptTimeoutError
        | TxFailedError
        | TxReplacedError
      >;
    },
    never,
    Scope.Scope
  >;

  readonly computeAddress: (params: {
    from: Address;
    nonce: bigint;
  }) => Effect.Effect<Address, never>;

  readonly verifyDeployment: (params: {
    chainId: number;
    address: Address;
  }) => Effect.Effect<boolean, DeploymentError | ClientNotFoundError>;

  readonly verifyDeploymentStrict: (params: {
    chainId: number;
    address: Address;
    expectedBytecode: Hex;
  }) => Effect.Effect<boolean, BytecodeMismatchError | DeploymentError | ClientNotFoundError>;
};

export class DeployService extends Context.Tag("ew3/DeployService")<
  DeployService,
  DeployServiceShape
>() {}

export const DeployServiceLive = Layer.effect(
  DeployService,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;
    const walletClientService = yield* WalletClientService;
    const txManager = yield* TxManager;
    const gasService = yield* GasService;

    return {
      computeAddress: Effect.fn("DeployService.computeAddress")(
        (params: { from: Address; nonce: bigint }) => {
          return Effect.sync(() => {
            // Use viem's getContractAddress
            return getContractAddress({
              from: params.from,
              nonce: params.nonce,
            });
          });
        }
      ),
      deploy: Effect.fn("DeployService.deploy")(function* <TAbi extends Abi>(
        params: {
          chainId: number;
          abi: TAbi;
          bytecode: Hex;
          value?: bigint;
          account?: Address;
          gas?: bigint;
        } & DeployArgsField<TAbi>
      ) {
        const walletClient = yield* walletClientService.get(params.chainId);
        const publicClient = yield* publicClientService.get(params.chainId);
        const account = params.account ?? walletClient.account?.address;
        const policy = defaultPolicy;

        if (!account) {
          return yield* Effect.fail(
            new WalletNotConnectedError({
              chainId: params.chainId,
              message: "No active account found. Provide `account` explicitly.",
            })
          );
        }

        const feeOverrides = yield* deriveFeeOverrides({
          chainId: params.chainId,
          policy,
        }).pipe(Effect.provideService(GasService, gasService));

        // Deploy the contract
        const hash = yield* Effect.tryPromise({
          catch: (cause) => {
            const error = cause as Error;
            // Check if this is a revert error
            if (error.message.includes("revert") || error.message.includes("execution reverted")) {
              return new DeploymentRevertedError({
                bytecode: params.bytecode,
                message: error.message,
                revertData: undefined, // viem doesn't provide revert data easily
              });
            }

            return new DeploymentError({
              cause,
              message: error instanceof Error ? error.message : "Deployment failed",
            });
          },
          try: () => {
            const base = {
              abi: params.abi,
              account,
              args: params.args,
              bytecode: params.bytecode,
              chain: walletClient.chain ?? null,
              gas: params.gas,
              value: params.value,
            };

            if ("gasPrice" in feeOverrides) {
              return walletClient.deployContract({
                ...base,
                gasPrice: feeOverrides.gasPrice,
                type: "legacy",
              });
            }

            return walletClient.deployContract({
              ...base,
              maxFeePerGas: feeOverrides.maxFeePerGas,
              maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas,
              type: "eip1559",
            });
          },
        });

        // Wait for receipt
        const receipt = yield* txManager.waitForReceipt(params.chainId, hash);

        // Contract address is in the receipt
        const address = receipt.contractAddress;
        if (!address) {
          return yield* Effect.fail(
            new DeploymentError({
              message: "Contract deployment succeeded but no address was returned",
            })
          );
        }

        // Get deployed bytecode
        const deployedBytecode = yield* Effect.tryPromise({
          catch: (cause) =>
            new DeploymentError({
              cause,
              message: "Failed to fetch deployed bytecode",
            }),
          try: () => publicClient.getBytecode({ address }),
        });

        if (!deployedBytecode) {
          return yield* Effect.fail(
            new DeploymentError({
              message: `No bytecode found at deployed address ${address}`,
            })
          );
        }

        return {
          address,
          deployedBytecode,
          hash,
          receipt,
        };
      }),

      deployAndTrack: <TAbi extends Abi>(
        params: {
          chainId: number;
          abi: TAbi;
          bytecode: Hex;
          value?: bigint;
          account?: Address;
          policy?: TxPolicy;
        } & DeployArgsField<TAbi>
      ) =>
        Effect.gen(function* () {
          const tracker = yield* makeTxTracker;
          const policy = params.policy ?? defaultPolicy;

          // Set initial state
          yield* tracker.set({ status: "idle" });

          const result = Effect.gen(function* () {
            // Get clients inside the result Effect so errors stay in the inner channel
            const walletClient = yield* walletClientService.get(params.chainId);
            const publicClient = yield* publicClientService.get(params.chainId);
            const account = params.account ?? walletClient.account?.address;

            if (!account) {
              return yield* Effect.fail(
                new WalletNotConnectedError({
                  chainId: params.chainId,
                  message: "No active account found. Provide `account` explicitly.",
                })
              );
            }

            const feeOverrides = yield* deriveFeeOverrides({
              chainId: params.chainId,
              policy,
            }).pipe(Effect.provideService(GasService, gasService));

            // Simulate
            yield* tracker.set({ status: "simulating" });

            // Deploy the contract
            yield* tracker.set({ status: "signing" });
            const hash = yield* Effect.tryPromise({
              catch: (cause) => {
                const error = cause as Error;
                if (
                  error.message.includes("revert") ||
                  error.message.includes("execution reverted")
                ) {
                  return new DeploymentRevertedError({
                    bytecode: params.bytecode,
                    message: error.message,
                    revertData: undefined,
                  });
                }

                return new DeploymentError({
                  cause,
                  message: error instanceof Error ? error.message : "Deployment failed",
                });
              },
              try: () => {
                const base = {
                  abi: params.abi,
                  account,
                  args: params.args,
                  bytecode: params.bytecode,
                  chain: walletClient.chain ?? null,
                  value: params.value,
                };

                if ("gasPrice" in feeOverrides) {
                  return walletClient.deployContract({
                    ...base,
                    gasPrice: feeOverrides.gasPrice,
                    type: "legacy",
                  });
                }

                return walletClient.deployContract({
                  ...base,
                  maxFeePerGas: feeOverrides.maxFeePerGas,
                  maxPriorityFeePerGas: feeOverrides.maxPriorityFeePerGas,
                  type: "eip1559",
                });
              },
            });

            yield* tracker.set({ hash, status: "submitted" });

            // Wait for receipt
            const receipt = yield* txManager.waitForReceipt(
              params.chainId,
              hash,
              policy.receiptTimeout
            );

            // Contract address is in the receipt
            const address = receipt.contractAddress;
            if (!address) {
              return yield* Effect.fail(
                new DeploymentError({
                  message: "Contract deployment succeeded but no address was returned",
                })
              );
            }

            // Get deployed bytecode
            const deployedBytecode = yield* Effect.tryPromise({
              catch: (cause) =>
                new DeploymentError({
                  cause,
                  message: "Failed to fetch deployed bytecode",
                }),
              try: () => publicClient.getBytecode({ address }),
            });

            if (!deployedBytecode) {
              return yield* Effect.fail(
                new DeploymentError({
                  message: `No bytecode found at deployed address ${address}`,
                })
              );
            }

            yield* tracker.set({ hash, receipt, status: "mined" });

            return {
              address,
              deployedBytecode,
              hash,
              receipt,
            };
          });

          return {
            result,
            stateRef: tracker.ref,
          };
        }),

      verifyDeployment: Effect.fn("DeployService.verifyDeployment")(function* (params: {
        chainId: number;
        address: Address;
      }) {
        const publicClient = yield* publicClientService.get(params.chainId);

        const actualBytecode = yield* Effect.tryPromise({
          catch: () =>
            new DeploymentError({
              message: "Failed to fetch bytecode for verification",
            }),
          try: () => publicClient.getBytecode({ address: params.address }),
        });

        if (!actualBytecode || actualBytecode === "0x") {
          return false;
        }

        return true;
      }),

      verifyDeploymentStrict: Effect.fn("DeployService.verifyDeploymentStrict")(function* (params: {
        chainId: number;
        address: Address;
        expectedBytecode: Hex;
      }) {
        const publicClient = yield* publicClientService.get(params.chainId);

        const actualBytecode = yield* Effect.tryPromise({
          catch: () =>
            new DeploymentError({
              message: "Failed to fetch bytecode for strict verification",
            }),
          try: () => publicClient.getBytecode({ address: params.address }),
        });

        if (!actualBytecode || actualBytecode === "0x") {
          return false;
        }

        if (actualBytecode !== params.expectedBytecode) {
          return yield* Effect.fail(
            new BytecodeMismatchError({
              actual: actualBytecode,
              address: params.address,
              expected: params.expectedBytecode,
              message: `Bytecode mismatch at ${params.address}`,
            })
          );
        }

        return true;
      }),
    };
  })
);
