/**
 * Internal helpers for ERC-721 service operations.
 * These reduce boilerplate by combining client retrieval with contract operations.
 *
 * Note: Uses type assertions internally because viem's strict ABI typing
 * doesn't allow generic function names/args at compile time.
 */

import { Effect } from "effect";
import type { Address, Hash, WalletClient } from "viem";
import { erc721Abi } from "#src/abi/index.js";
import type {
  PublicClientServiceShape,
  WalletClientServiceShape,
} from "#src/core/clients/index.js";
import type {
  ClientNotFoundError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "#src/core/errors/index.js";
import { viemTryPromise, withPublicClient, withWalletClient } from "#src/internal/index.js";

/**
 * Read from an ERC-721 contract with automatic client retrieval and error handling.
 */
export const readErc721 = <TResult, E>(
  publicClientService: PublicClientServiceShape,
  params: {
    address: Address;
    args?: readonly unknown[];
    chainId: number;
    errorFactory: (cause: unknown) => E;
    functionName: string;
  }
): Effect.Effect<TResult, E | ClientNotFoundError> =>
  withPublicClient(publicClientService, params.chainId, (client) =>
    viemTryPromise(
      () =>
        client.readContract({
          abi: erc721Abi,
          address: params.address,
          args: params.args as never,
          functionName: params.functionName as never,
        }) as Promise<TResult>,
      params.errorFactory
    )
  );

/**
 * Write to an ERC-721 contract with automatic client retrieval and error handling.
 */
export const writeErc721 = <E>(
  walletClientService: WalletClientServiceShape,
  params: {
    account: Address;
    address: Address;
    args: readonly unknown[];
    chainId: number;
    errorFactory: (cause: unknown) => E;
    functionName: string;
  }
): Effect.Effect<Hash, E | WalletNotConnectedError | WrongNetworkError> =>
  withWalletClient(walletClientService, params.chainId, (walletClient) =>
    viemTryPromise(
      () =>
        walletClient.writeContract({
          abi: erc721Abi,
          account: params.account,
          address: params.address,
          args: params.args as never,
          chain: walletClient.chain ?? null,
          functionName: params.functionName as never,
        }),
      params.errorFactory
    )
  );

/**
 * Helper to resolve account from wallet client or explicit param.
 */
export const resolveAccount = (
  walletClient: WalletClient,
  params: { account?: Address; chainId: number },
  errorFactory: (chainId: number) => WalletNotConnectedError
): Effect.Effect<Address, WalletNotConnectedError> => {
  if (params.account) {
    return Effect.succeed(params.account);
  }
  const account = walletClient.account?.address;
  if (account) {
    return Effect.succeed(account);
  }
  return Effect.fail(errorFactory(params.chainId));
};
