import { Context, Effect, Layer } from "effect";
import type { Address } from "viem";
import { mainnet } from "viem/chains";
import { normalize } from "viem/ens";
import type { ClientNotFoundError } from "#src/core/index.js";
import { PublicClientService } from "#src/core/index.js";
import {
  EnsAvatarNotFoundError,
  EnsNameNotFoundError,
  EnsResolutionError,
  EnsResolverNotConfiguredError,
  EnsReverseNameNotFoundError,
  EnsTextNotFoundError,
} from "#src/ens/errors.js";
import { SpanNames } from "#src/telemetry/index.js";

type AssetGatewayUrls = {
  arweave?: string;
  ipfs?: string;
};

/**
 * Service for ENS (Ethereum Name Service) resolution
 *
 * All operations target Ethereum mainnet (chainId=1) since ENS
 * primarily lives there. Names are automatically normalized.
 */
export type EnsResolverShape = {
  /**
   * Resolve an ENS name to an address
   *
   * @param name - The ENS name to resolve (e.g., "vitalik.eth")
   * @param opts.coinType - Optional ENSIP-19 coinType for cross-chain resolution
   */
  readonly getAddress: (
    name: string,
    opts?: { coinType?: bigint }
  ) => Effect.Effect<Address, EnsNameNotFoundError | EnsResolutionError | ClientNotFoundError>;

  /**
   * Get the avatar URL for an ENS name
   *
   * @param name - The ENS name to get avatar for
   * @param opts.assetGatewayUrls - Optional gateway URLs for IPFS/Arweave
   */
  readonly getAvatar: (
    name: string,
    opts?: { assetGatewayUrls?: AssetGatewayUrls }
  ) => Effect.Effect<string, EnsAvatarNotFoundError | EnsResolutionError | ClientNotFoundError>;

  /**
   * Reverse resolve an address to its primary ENS name
   *
   * @param address - The address to resolve
   */
  readonly getName: (
    address: Address
  ) => Effect.Effect<
    string,
    EnsReverseNameNotFoundError | EnsResolutionError | ClientNotFoundError
  >;

  /**
   * Get the resolver contract address for an ENS name
   *
   * @param name - The ENS name to get resolver for
   */
  readonly getResolver: (
    name: string
  ) => Effect.Effect<
    Address,
    EnsResolverNotConfiguredError | EnsResolutionError | ClientNotFoundError
  >;

  /**
   * Get a text record for an ENS name
   *
   * @param name - The ENS name to query
   * @param key - The text record key (e.g., "com.twitter", "url", "description")
   */
  readonly getText: (
    name: string,
    key: string
  ) => Effect.Effect<string, EnsTextNotFoundError | EnsResolutionError | ClientNotFoundError>;
};

export class EnsResolver extends Context.Tag("ew3/EnsResolver")<EnsResolver, EnsResolverShape>() {}

/**
 * Live implementation of EnsResolver service
 *
 * Requires PublicClientService with mainnet (chainId=1) configured
 */
export const EnsResolverLive = Layer.effect(
  EnsResolver,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    return EnsResolver.of({
      getAddress: (name: string, opts?: { coinType?: bigint }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(mainnet.id);
          const normalizedName = normalize(name);

          const result = yield* Effect.tryPromise({
            catch: (cause) =>
              new EnsResolutionError({
                cause,
                message: `Failed to resolve ENS name: ${String(cause)}`,
                name: normalizedName,
              }),
            try: () =>
              client.getEnsAddress({
                coinType: opts?.coinType,
                name: normalizedName,
              }),
          });

          if (result === null) {
            return yield* Effect.fail(
              new EnsNameNotFoundError({
                message: `No address found for ENS name "${normalizedName}"`,
                name: normalizedName,
              })
            );
          }

          return result;
        }).pipe(
          Effect.withSpan(SpanNames.ENS_GET_ADDRESS, {
            attributes: {
              coinType: opts?.coinType?.toString(),
              name,
            },
          })
        ),

      getAvatar: (name: string, opts?: { assetGatewayUrls?: AssetGatewayUrls }) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(mainnet.id);
          const normalizedName = normalize(name);

          const result = yield* Effect.tryPromise({
            catch: (cause) =>
              new EnsResolutionError({
                cause,
                message: `Failed to get ENS avatar: ${String(cause)}`,
                name: normalizedName,
              }),
            try: () =>
              client.getEnsAvatar({
                assetGatewayUrls: opts?.assetGatewayUrls,
                name: normalizedName,
              }),
          });

          if (result === null) {
            return yield* Effect.fail(
              new EnsAvatarNotFoundError({
                message: `No avatar found for ENS name "${normalizedName}"`,
                name: normalizedName,
              })
            );
          }

          return result;
        }).pipe(
          Effect.withSpan(SpanNames.ENS_GET_AVATAR, {
            attributes: {
              name,
            },
          })
        ),

      getName: (address: Address) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(mainnet.id);

          const result = yield* Effect.tryPromise({
            catch: (cause) =>
              new EnsResolutionError({
                cause,
                message: `Failed to reverse resolve address: ${String(cause)}`,
                name: address,
              }),
            try: () =>
              client.getEnsName({
                address,
              }),
          });

          if (result === null) {
            return yield* Effect.fail(
              new EnsReverseNameNotFoundError({
                address,
                message: `No ENS name found for address "${address}"`,
              })
            );
          }

          return result;
        }).pipe(
          Effect.withSpan(SpanNames.ENS_GET_NAME, {
            attributes: {
              address,
            },
          })
        ),

      getResolver: (name: string) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(mainnet.id);
          const normalizedName = normalize(name);

          const result = yield* Effect.tryPromise({
            catch: (cause) =>
              new EnsResolutionError({
                cause,
                message: `Failed to get ENS resolver: ${String(cause)}`,
                name: normalizedName,
              }),
            try: () =>
              client.getEnsResolver({
                name: normalizedName,
              }),
          });

          if (result === null || result === "0x0000000000000000000000000000000000000000") {
            return yield* Effect.fail(
              new EnsResolverNotConfiguredError({
                message: `No resolver configured for ENS name "${normalizedName}"`,
                name: normalizedName,
              })
            );
          }

          return result;
        }).pipe(
          Effect.withSpan(SpanNames.ENS_GET_RESOLVER, {
            attributes: {
              name,
            },
          })
        ),

      getText: (name: string, key: string) =>
        Effect.gen(function* () {
          const client = yield* publicClientService.get(mainnet.id);
          const normalizedName = normalize(name);

          const result = yield* Effect.tryPromise({
            catch: (cause) =>
              new EnsResolutionError({
                cause,
                message: `Failed to get ENS text record: ${String(cause)}`,
                name: normalizedName,
              }),
            try: () =>
              client.getEnsText({
                key,
                name: normalizedName,
              }),
          });

          if (result === null) {
            return yield* Effect.fail(
              new EnsTextNotFoundError({
                key,
                message: `No text record "${key}" found for ENS name "${normalizedName}"`,
                name: normalizedName,
              })
            );
          }

          return result;
        }).pipe(
          Effect.withSpan(SpanNames.ENS_GET_TEXT, {
            attributes: {
              key,
              name,
            },
          })
        ),
    });
  })
);
