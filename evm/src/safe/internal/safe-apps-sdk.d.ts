declare module "@safe-global/safe-apps-sdk" {
  export type Opts = {
    allowedDomains?: RegExp[];
    debug?: boolean;
  };

  export type BaseTransaction = {
    to: string;
    value: string;
    data: string;
  };

  export type SendTransactionRequestParams = {
    safeTxGas?: number;
  };

  export type SendTransactionsParams = {
    txs: BaseTransaction[];
    params?: SendTransactionRequestParams;
  };

  export type SendTransactionsResponse = {
    safeTxHash: string;
  };

  export type OffChainSignMessageResponse = {
    messageHash: string;
  };

  export type SignMessageResponse = SendTransactionsResponse | OffChainSignMessageResponse;

  export type GatewayTransactionDetails = {
    txHash?: string;
    txStatus?: string;
  };

  export type SafeInfoExtended = {
    chainId: number;
    safeAddress: string;
  };

  export type TypedDataDomain = {
    name?: string;
    version?: string;
    chainId?: string | number | bigint | { toNumber: () => number };
    verifyingContract?: string;
    salt?: string;
  };

  export type TypedDataTypes = {
    name: string;
    type: string;
  };

  export type TypedMessageTypes = Record<string, TypedDataTypes[]>;

  export type EIP712TypedData = {
    domain: TypedDataDomain;
    types: TypedMessageTypes;
    message: Record<string, unknown>;
    primaryType?: string;
  };

  export type SafeSettings = {
    offChainSigning?: boolean;
  };

  export default class SafeAppsSDK {
    constructor(opts?: Opts);

    safe: {
      getInfo(): Promise<SafeInfoExtended>;
      getOffChainSignature(hash: string): Promise<string>;
    };

    txs: {
      send(opts: SendTransactionsParams): Promise<SendTransactionsResponse>;
      getBySafeTxHash(hash: string): Promise<GatewayTransactionDetails>;
      signTypedMessage(data: EIP712TypedData): Promise<SignMessageResponse>;
    };

    eth: {
      setSafeSettings(settings: [SafeSettings]): Promise<SafeSettings>;
    };
  }
}
