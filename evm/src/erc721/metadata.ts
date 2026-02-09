import { Effect } from "effect";
import { Erc721MetadataFetchError } from "#src/erc721/errors.js";

export type NftMetadata = {
  animation_url?: string;
  attributes?: Array<{
    display_type?: string;
    trait_type: string;
    value: number | string;
  }>;
  description?: string;
  external_url?: string;
  image?: string;
  name?: string;
  [key: string]: unknown;
};

type GatewayConfig = {
  arweave?: string;
  ipfs?: string;
};

const DATA_URI_BASE64_JSON_RE = /^data:application\/json;base64,(.+)$/;
const DATA_URI_PLAIN_JSON_RE = /^data:application\/json,(.+)$/;

const DEFAULT_GATEWAYS: GatewayConfig = {
  arweave: "https://arweave.net/",
  ipfs: "https://ipfs.io/ipfs/",
};

/**
 * Resolve gateway URLs for IPFS and Arweave URIs
 */
export const resolveUri = (uri: string, gateways?: GatewayConfig): string => {
  const config = { ...DEFAULT_GATEWAYS, ...gateways };

  // Handle IPFS URIs
  if (uri.startsWith("ipfs://")) {
    const hash = uri.replace("ipfs://", "");
    return `${config.ipfs}${hash}`;
  }

  // Handle Arweave URIs
  if (uri.startsWith("ar://")) {
    const hash = uri.replace("ar://", "");
    return `${config.arweave}${hash}`;
  }

  // Data URIs and HTTP(S) URIs pass through
  return uri;
};

/**
 * Fetch and parse NFT metadata from a URI
 */
export const fetchNftMetadata = (
  uri: string,
  params: {
    address: string;
    chainId: number;
    gateways?: GatewayConfig;
    tokenId: bigint;
  }
): Effect.Effect<NftMetadata, Erc721MetadataFetchError> =>
  Effect.gen(function* () {
    // Handle data URIs
    if (uri.startsWith("data:")) {
      const match = uri.match(DATA_URI_BASE64_JSON_RE);
      if (match) {
        const decoded = Buffer.from(match[1], "base64").toString("utf-8");
        return JSON.parse(decoded) as NftMetadata;
      }
      const jsonMatch = uri.match(DATA_URI_PLAIN_JSON_RE);
      if (jsonMatch) {
        return JSON.parse(decodeURIComponent(jsonMatch[1])) as NftMetadata;
      }
    }

    // Resolve gateway URL
    const resolvedUri = resolveUri(uri, params.gateways);

    // Fetch metadata
    const response = yield* Effect.tryPromise({
      catch: (cause) =>
        new Erc721MetadataFetchError({
          address: params.address,
          cause,
          chainId: params.chainId,
          message: `Failed to fetch metadata: ${String(cause)}`,
          tokenId: params.tokenId,
          uri: resolvedUri,
        }),
      try: () => fetch(resolvedUri),
    });

    if (!response.ok) {
      return yield* Effect.fail(
        new Erc721MetadataFetchError({
          address: params.address,
          chainId: params.chainId,
          message: `HTTP ${response.status}: ${response.statusText}`,
          tokenId: params.tokenId,
          uri: resolvedUri,
        })
      );
    }

    const metadata = yield* Effect.tryPromise({
      catch: (cause) =>
        new Erc721MetadataFetchError({
          address: params.address,
          cause,
          chainId: params.chainId,
          message: `Failed to parse JSON metadata: ${String(cause)}`,
          tokenId: params.tokenId,
          uri: resolvedUri,
        }),
      try: () => response.json() as Promise<NftMetadata>,
    });

    return metadata;
  });
