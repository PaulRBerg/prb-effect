import { Context, Effect, Layer } from "effect";
import type { Address, Hash, Hex } from "viem";
import type { ClientNotFoundError, WrongNetworkError } from "#src/core/errors/index.js";
import {
  ContractReadError,
  ContractWriteError,
  WalletNotConnectedError,
} from "#src/core/errors/index.js";
import { PublicClientService, WalletClientService } from "#src/core/index.js";
import {
  Erc721MetadataFetchError,
  Erc721NoTokenURIError,
  Erc721OwnerNotFoundError,
  Erc721TransferError,
} from "#src/erc721/errors.js";
import { readErc721, resolveAccount, writeErc721 } from "#src/erc721/helpers.js";
import type { NftMetadata } from "#src/erc721/metadata.js";
import { fetchNftMetadata } from "#src/erc721/metadata.js";
import { withWalletClient } from "#src/internal/index.js";
import { SpanNames } from "#src/telemetry/index.js";

export type Erc721ServiceShape = {
  readonly ownerOf: (params: {
    address: Address;
    chainId: number;
    tokenId: bigint;
  }) => Effect.Effect<Address, Erc721OwnerNotFoundError | ClientNotFoundError>;

  readonly balanceOf: (params: {
    address: Address;
    chainId: number;
    owner: Address;
  }) => Effect.Effect<bigint, ContractReadError | ClientNotFoundError>;

  readonly getApproved: (params: {
    address: Address;
    chainId: number;
    tokenId: bigint;
  }) => Effect.Effect<Address, ContractReadError | ClientNotFoundError>;

  readonly isApprovedForAll: (params: {
    address: Address;
    chainId: number;
    operator: Address;
    owner: Address;
  }) => Effect.Effect<boolean, ContractReadError | ClientNotFoundError>;

  readonly approve: (params: {
    account?: Address;
    address: Address;
    chainId: number;
    to: Address;
    tokenId: bigint;
  }) => Effect.Effect<Hash, ContractWriteError | WalletNotConnectedError | WrongNetworkError>;

  readonly setApprovalForAll: (params: {
    account?: Address;
    address: Address;
    approved: boolean;
    chainId: number;
    operator: Address;
  }) => Effect.Effect<Hash, ContractWriteError | WalletNotConnectedError | WrongNetworkError>;

  readonly transferFrom: (params: {
    account?: Address;
    address: Address;
    chainId: number;
    from: Address;
    to: Address;
    tokenId: bigint;
  }) => Effect.Effect<Hash, Erc721TransferError | WalletNotConnectedError | WrongNetworkError>;

  readonly safeTransferFrom: (params: {
    account?: Address;
    address: Address;
    chainId: number;
    data?: Hex;
    from: Address;
    to: Address;
    tokenId: bigint;
  }) => Effect.Effect<Hash, Erc721TransferError | WalletNotConnectedError | WrongNetworkError>;

  readonly tokenURI: (params: {
    address: Address;
    chainId: number;
    tokenId: bigint;
  }) => Effect.Effect<string, Erc721NoTokenURIError | ContractReadError | ClientNotFoundError>;

  readonly fetchMetadata: (params: {
    address: Address;
    chainId: number;
    gateways?: { arweave?: string; ipfs?: string };
    tokenId: bigint;
  }) => Effect.Effect<NftMetadata, Erc721MetadataFetchError | ClientNotFoundError>;

  readonly name: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<string, ContractReadError | ClientNotFoundError>;

  readonly symbol: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<string, ContractReadError | ClientNotFoundError>;

  readonly totalSupply: (params: {
    address: Address;
    chainId: number;
  }) => Effect.Effect<bigint, ContractReadError | ClientNotFoundError>;
};

export class Erc721Service extends Context.Service<Erc721Service, Erc721ServiceShape>()(
  "ew3/Erc721Service"
) {}

// Helper to create ContractReadError
const makeReadError = (address: Address, functionName: string) => (cause: unknown) =>
  new ContractReadError({
    address,
    cause,
    functionName,
    message: `Failed to ${functionName}: ${String(cause)}`,
  });

// Helper to create ContractWriteError
const makeWriteError = (address: Address, functionName: string) => (cause: unknown) =>
  new ContractWriteError({
    address,
    cause,
    functionName,
    message: `Failed to ${functionName}: ${String(cause)}`,
  });

// Helper to create WalletNotConnectedError
const makeWalletError = (chainId: number) =>
  new WalletNotConnectedError({
    chainId,
    message: "Wallet client has no active account. Provide `account` explicitly.",
  });

export const Erc721ServiceLive = Layer.effect(
  Erc721Service,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;
    const walletClientService = yield* WalletClientService;

    return Erc721Service.of({
      approve: (params) =>
        withWalletClient(walletClientService, params.chainId, (walletClient) =>
          Effect.gen(function* () {
            const account = yield* resolveAccount(walletClient, params, makeWalletError);
            return yield* writeErc721(walletClientService, {
              account,
              address: params.address,
              args: [params.to, params.tokenId],
              chainId: params.chainId,
              errorFactory: makeWriteError(params.address, "approve"),
              functionName: "approve",
            });
          })
        ).pipe(
          Effect.withSpan(SpanNames.ERC721_APPROVE, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              to: params.to,
              tokenId: params.tokenId.toString(),
            },
          })
        ),

      balanceOf: (params) =>
        readErc721<bigint, ContractReadError>(publicClientService, {
          address: params.address,
          args: [params.owner],
          chainId: params.chainId,
          errorFactory: makeReadError(params.address, "balanceOf"),
          functionName: "balanceOf",
        }).pipe(
          Effect.withSpan(SpanNames.ERC721_BALANCE_OF, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              owner: params.owner,
            },
          })
        ),

      fetchMetadata: (params) =>
        Effect.gen(function* () {
          const uri = yield* readErc721<string, Erc721MetadataFetchError>(publicClientService, {
            address: params.address,
            args: [params.tokenId],
            chainId: params.chainId,
            functionName: "tokenURI",
            errorFactory: (cause) =>
              new Erc721MetadataFetchError({
                address: params.address,
                cause,
                chainId: params.chainId,
                message: `Failed to get token URI: ${String(cause)}`,
                tokenId: params.tokenId,
                uri: "",
              }),
          });

          if (!uri || uri === "") {
            return yield* Effect.fail(
              new Erc721MetadataFetchError({
                address: params.address,
                chainId: params.chainId,
                message: `Token URI is empty for token ${params.tokenId}`,
                tokenId: params.tokenId,
                uri: "",
              })
            );
          }

          return yield* fetchNftMetadata(uri, {
            address: params.address,
            chainId: params.chainId,
            gateways: params.gateways,
            tokenId: params.tokenId,
          });
        }).pipe(
          Effect.withSpan(SpanNames.ERC721_FETCH_METADATA, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              tokenId: params.tokenId.toString(),
            },
          })
        ),

      getApproved: (params) =>
        readErc721<Address, ContractReadError>(publicClientService, {
          address: params.address,
          args: [params.tokenId],
          chainId: params.chainId,
          errorFactory: makeReadError(params.address, "getApproved"),
          functionName: "getApproved",
        }).pipe(
          Effect.withSpan(SpanNames.ERC721_GET_APPROVED, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              tokenId: params.tokenId.toString(),
            },
          })
        ),

      isApprovedForAll: (params) =>
        readErc721<boolean, ContractReadError>(publicClientService, {
          address: params.address,
          args: [params.owner, params.operator],
          chainId: params.chainId,
          errorFactory: makeReadError(params.address, "isApprovedForAll"),
          functionName: "isApprovedForAll",
        }).pipe(
          Effect.withSpan(SpanNames.ERC721_IS_APPROVED_FOR_ALL, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              operator: params.operator,
              owner: params.owner,
            },
          })
        ),

      name: (params) =>
        readErc721<string, ContractReadError>(publicClientService, {
          address: params.address,
          chainId: params.chainId,
          errorFactory: makeReadError(params.address, "name"),
          functionName: "name",
        }).pipe(
          Effect.withSpan(SpanNames.ERC721_NAME, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
            },
          })
        ),

      ownerOf: (params) =>
        readErc721<Address, Erc721OwnerNotFoundError>(publicClientService, {
          address: params.address,
          args: [params.tokenId],
          chainId: params.chainId,
          functionName: "ownerOf",
          errorFactory: (cause) =>
            new Erc721OwnerNotFoundError({
              address: params.address,
              chainId: params.chainId,
              message: `Failed to get owner: ${String(cause)}`,
              tokenId: params.tokenId,
            }),
        }).pipe(
          Effect.withSpan(SpanNames.ERC721_OWNER_OF, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              tokenId: params.tokenId.toString(),
            },
          })
        ),

      safeTransferFrom: (params) =>
        withWalletClient(walletClientService, params.chainId, (walletClient) =>
          Effect.gen(function* () {
            const account = yield* resolveAccount(walletClient, params, makeWalletError);
            const errorFactory = (cause: unknown) =>
              new Erc721TransferError({
                address: params.address,
                cause,
                from: params.from,
                message: `Failed to safeTransferFrom: ${String(cause)}`,
                to: params.to,
                tokenId: params.tokenId,
              });

            const args =
              params.data === undefined
                ? [params.from, params.to, params.tokenId]
                : [params.from, params.to, params.tokenId, params.data];

            return yield* writeErc721(walletClientService, {
              account,
              address: params.address,
              args,
              chainId: params.chainId,
              errorFactory,
              functionName: "safeTransferFrom",
            });
          })
        ).pipe(
          Effect.withSpan(SpanNames.ERC721_SAFE_TRANSFER_FROM, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              from: params.from,
              to: params.to,
              tokenId: params.tokenId.toString(),
            },
          })
        ),

      setApprovalForAll: (params) =>
        withWalletClient(walletClientService, params.chainId, (walletClient) =>
          Effect.gen(function* () {
            const account = yield* resolveAccount(walletClient, params, makeWalletError);
            return yield* writeErc721(walletClientService, {
              account,
              address: params.address,
              args: [params.operator, params.approved],
              chainId: params.chainId,
              errorFactory: makeWriteError(params.address, "setApprovalForAll"),
              functionName: "setApprovalForAll",
            });
          })
        ).pipe(
          Effect.withSpan(SpanNames.ERC721_SET_APPROVAL_FOR_ALL, {
            attributes: {
              address: params.address,
              approved: params.approved,
              chainId: params.chainId,
              operator: params.operator,
            },
          })
        ),

      symbol: (params) =>
        readErc721<string, ContractReadError>(publicClientService, {
          address: params.address,
          chainId: params.chainId,
          errorFactory: makeReadError(params.address, "symbol"),
          functionName: "symbol",
        }).pipe(
          Effect.withSpan(SpanNames.ERC721_SYMBOL, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
            },
          })
        ),

      tokenURI: (params) =>
        Effect.gen(function* () {
          const uri = yield* readErc721<string, ContractReadError>(publicClientService, {
            address: params.address,
            args: [params.tokenId],
            chainId: params.chainId,
            errorFactory: makeReadError(params.address, "tokenURI"),
            functionName: "tokenURI",
          });

          if (!uri || uri === "") {
            return yield* Effect.fail(
              new Erc721NoTokenURIError({
                address: params.address,
                chainId: params.chainId,
                message: `Token URI is empty for token ${params.tokenId}`,
                tokenId: params.tokenId,
              })
            );
          }

          return uri;
        }).pipe(
          Effect.withSpan(SpanNames.ERC721_TOKEN_URI, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              tokenId: params.tokenId.toString(),
            },
          })
        ),

      totalSupply: (params) =>
        readErc721<bigint, ContractReadError>(publicClientService, {
          address: params.address,
          chainId: params.chainId,
          errorFactory: makeReadError(params.address, "totalSupply"),
          functionName: "totalSupply",
        }).pipe(
          Effect.withSpan(SpanNames.ERC721_TOTAL_SUPPLY, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
            },
          })
        ),

      transferFrom: (params) =>
        withWalletClient(walletClientService, params.chainId, (walletClient) =>
          Effect.gen(function* () {
            const account = yield* resolveAccount(walletClient, params, makeWalletError);
            return yield* writeErc721(walletClientService, {
              account,
              address: params.address,
              args: [params.from, params.to, params.tokenId],
              chainId: params.chainId,
              functionName: "transferFrom",
              errorFactory: (cause) =>
                new Erc721TransferError({
                  address: params.address,
                  cause,
                  from: params.from,
                  message: `Failed to transferFrom: ${String(cause)}`,
                  to: params.to,
                  tokenId: params.tokenId,
                }),
            });
          })
        ).pipe(
          Effect.withSpan(SpanNames.ERC721_TRANSFER_FROM, {
            attributes: {
              address: params.address,
              chainId: params.chainId,
              from: params.from,
              to: params.to,
              tokenId: params.tokenId.toString(),
            },
          })
        ),
    });
  })
);
