import type { Address, Chain, Hex, TransactionRequest, TypedData, TypedDataDefinition } from "viem";

export type SignMessageParams = {
  account?: Address;
  message: string | { raw: Hex };
};

export type SignTypedDataParams<
  typedData extends TypedData | Record<string, unknown> = TypedData,
  primaryType extends keyof typedData | "EIP712Domain" = keyof typedData,
> = TypedDataDefinition<typedData, primaryType> & {
  account?: Address;
};

export type SignTransactionParams = TransactionRequest;

export type WalletProvider = {
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
  request: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
};

export type AddChainParams = Chain & {
  rpcUrls?: {
    http: string[];
    webSocket?: string[];
  };
  blockExplorerUrls?: string[];
  iconUrls?: string[];
};

export type WatchAssetParams = {
  type: "ERC20";
  options: {
    address: Address;
    symbol: string;
    decimals: number;
    image?: string;
  };
};
