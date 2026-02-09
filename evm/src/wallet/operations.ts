import { Effect } from "effect";
import type { Address, Hex, TypedData } from "viem";
import { isLikelyUserRejectedError, isUserRejectedError } from "#src/core/errors/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import type {
  SignMessageParams,
  SignTransactionParams,
  SignTypedDataParams,
  WalletProvider,
} from "#src/wallet/index.js";
import {
  AccountNotConnectedError,
  SignMessageError,
  SignTxError,
  SignTypedDataError,
} from "#src/wallet/index.js";

/**
 * Detect if an error is a user rejection
 */
const isUserRejection = (error: unknown): boolean => isUserRejectedError(error);
const isLikelyUserRejection = (error: unknown): boolean => isLikelyUserRejectedError(error);

const errorCode = (error: unknown): number | undefined => {
  if (!error || typeof error !== "object") {
    return;
  }
  const code = (error as { code?: unknown }).code;
  return typeof code === "number" ? code : undefined;
};

const messageOf = (error: unknown): string => {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  return String(error);
};

const isMethodNotFound = (error: unknown): boolean => {
  const code = errorCode(error);
  if (code === -32_601) {
    return true;
  }
  const msg = messageOf(error).toLowerCase();
  return msg.includes("method not found") || msg.includes("does not exist");
};

const isInvalidParams = (error: unknown): boolean => {
  const code = errorCode(error);
  if (code === -32_602) {
    return true;
  }
  const msg = messageOf(error).toLowerCase();
  return msg.includes("invalid params") || msg.includes("invalid parameter");
};

const requestHex = async (
  provider: WalletProvider,
  method: string,
  methodParams: unknown[]
): Promise<Hex> => {
  const result = await provider.request({
    method,
    params: methodParams,
  });
  return result as Hex;
};

const signTypedDataFallbacks = async (
  provider: WalletProvider,
  account: Address,
  typedDataPayload: unknown
): Promise<Hex> => {
  const json = JSON.stringify(typedDataPayload);
  const attempts: ReadonlyArray<{
    method: string;
    params: readonly unknown[];
  }> = [
    { method: "eth_signTypedData_v4", params: [account, json] },
    { method: "eth_signTypedData_v3", params: [account, json] },
    { method: "eth_signTypedData", params: [account, typedDataPayload] },
  ];

  let lastError: unknown;
  for (const attempt of attempts) {
    try {
      return await requestHex(provider, attempt.method, [...attempt.params]);
    } catch (e) {
      if (isUserRejection(e)) {
        throw e;
      }
      lastError = e;

      const shouldTryNext = attempt.method !== "eth_signTypedData" && isMethodNotFound(e);

      if (!shouldTryNext) {
        throw e;
      }
    }
  }

  throw lastError;
};

/**
 * Sign a message using the wallet's personal_sign method
 */
export function signMessage(
  provider: WalletProvider,
  params: SignMessageParams
): Effect.Effect<Hex, SignMessageError | AccountNotConnectedError> {
  return Effect.gen(function* () {
    // Get the current account if not provided
    const account =
      params.account ??
      (yield* Effect.tryPromise({
        catch: (error) =>
          new AccountNotConnectedError({
            message: error instanceof Error ? error.message : "Failed to get wallet account",
          }),
        try: async () => {
          const accounts = (await provider.request({
            method: "eth_accounts",
          })) as Address[];
          if (accounts.length === 0) {
            throw new Error("No wallet account connected");
          }
          return accounts[0];
        },
      }));

    // Prepare the message
    const message = typeof params.message === "string" ? params.message : params.message.raw;

    // Sign the message
    return yield* Effect.tryPromise({
      catch: (cause) => {
        const errorMessage = messageOf(cause) || "Failed to sign message";
        const isRejection = isLikelyUserRejection(cause);
        return new SignMessageError({
          cause,
          message: isRejection ? "User rejected the request" : errorMessage,
        });
      },
      try: async () => {
        try {
          const result = await provider.request({
            method: "personal_sign",
            params: [message, account],
          });
          return result as Hex;
        } catch (e) {
          if (isUserRejection(e)) {
            throw e;
          }

          if (!isInvalidParams(e)) {
            throw e;
          }

          // Fallback for providers that expect reversed parameter order.
          const result = await provider.request({
            method: "personal_sign",
            params: [account, message],
          });
          return result as Hex;
        }
      },
    });
  }).pipe(
    Effect.withSpan(SpanNames.WALLET_SIGN_MESSAGE, {
      attributes: {
        account: params.account,
      },
    })
  );
}

/**
 * Sign typed data using the wallet's eth_signTypedData_v4 method
 */
export function signTypedData<
  const typedData extends TypedData | Record<string, unknown>,
  primaryType extends keyof typedData | "EIP712Domain",
>(
  provider: WalletProvider,
  params: SignTypedDataParams<typedData, primaryType>
): Effect.Effect<Hex, SignTypedDataError | AccountNotConnectedError> {
  return Effect.gen(function* () {
    // Get the current account if not provided
    const account =
      params.account ??
      (yield* Effect.tryPromise({
        catch: (error) =>
          new AccountNotConnectedError({
            message: error instanceof Error ? error.message : "Failed to get wallet account",
          }),
        try: async () => {
          const accounts = (await provider.request({
            method: "eth_accounts",
          })) as Address[];
          if (accounts.length === 0) {
            throw new Error("No wallet account connected");
          }
          return accounts[0];
        },
      }));

    // Prepare the typed data payload
    const typedDataPayload = {
      domain: params.domain,
      message: params.message,
      primaryType: params.primaryType,
      types: params.types,
    };

    // Sign the typed data
    return yield* Effect.tryPromise({
      catch: (cause) => {
        const errorMessage = messageOf(cause) || "Failed to sign typed data";
        const isRejection = isLikelyUserRejection(cause);
        return new SignTypedDataError({
          cause,
          message: isRejection ? "User rejected the request" : errorMessage,
        });
      },
      try: async () => await signTypedDataFallbacks(provider, account, typedDataPayload),
    });
  }).pipe(
    Effect.withSpan(SpanNames.WALLET_SIGN_TYPED_DATA, {
      attributes: {
        account: params.account,
        primaryType: params.primaryType,
      },
    })
  );
}

/**
 * Sign a transaction using the wallet's eth_signTransaction method
 */
export function signTransaction(
  provider: WalletProvider,
  params: SignTransactionParams
): Effect.Effect<Hex, SignTxError | AccountNotConnectedError> {
  return Effect.gen(function* () {
    // Get the current account if not provided
    const account =
      params.from ??
      (yield* Effect.tryPromise({
        catch: (error) =>
          new AccountNotConnectedError({
            message: error instanceof Error ? error.message : "Failed to get wallet account",
          }),
        try: async () => {
          const accounts = (await provider.request({
            method: "eth_accounts",
          })) as Address[];
          if (accounts.length === 0) {
            throw new Error("No wallet account connected");
          }
          return accounts[0];
        },
      }));

    // Sign the transaction
    return yield* Effect.tryPromise({
      catch: (cause) => {
        const errorMessage = cause instanceof Error ? cause.message : "Failed to sign transaction";
        const isRejection = isLikelyUserRejection(cause);
        return new SignTxError({
          cause,
          message: isRejection ? "User rejected the request" : errorMessage,
        });
      },
      try: async () => {
        const result = await provider.request({
          method: "eth_signTransaction",
          params: [{ ...params, from: account }],
        });
        return result as Hex;
      },
    });
  });
}
