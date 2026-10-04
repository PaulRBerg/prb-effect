import { Context, Effect, Layer } from "effect";
import type {
  Address,
  HashTypedDataParameters,
  Hex,
  RecoverTypedDataAddressParameters,
  SignableMessage,
  TypedData,
  VerifyTypedDataParameters,
} from "viem";
import {
  hashMessage,
  hashTypedData,
  recoverMessageAddress,
  recoverTypedDataAddress,
  verifyMessage,
  verifyTypedData,
} from "viem";
import { SpanNames } from "#src/telemetry/index.js";
import {
  InvalidSignatureError,
  SignatureRecoveryError,
  SignatureVerificationError,
} from "./errors.js";
import { constructSignature, extractSignatureComponents, isValidSignature } from "./utils.js";

const toSignableMessage = (message: string | Uint8Array): SignableMessage =>
  typeof message === "string" ? message : { raw: message };

export type SignatureServiceShape = {
  readonly verifyMessage: (params: {
    address: Address;
    message: string | Uint8Array;
    signature: Hex;
  }) => Effect.Effect<boolean, SignatureVerificationError>;

  readonly verifyTypedData: <
    const TTypedData extends TypedData | Record<string, unknown>,
    TPrimaryType extends keyof TTypedData | "EIP712Domain",
  >(
    params: VerifyTypedDataParameters<TTypedData, TPrimaryType>
  ) => Effect.Effect<boolean, SignatureVerificationError>;

  readonly recoverAddress: (params: {
    message: string | Uint8Array;
    signature: Hex;
  }) => Effect.Effect<Address, SignatureRecoveryError>;

  readonly recoverTypedDataAddress: <
    const TTypedData extends TypedData | Record<string, unknown>,
    TPrimaryType extends keyof TTypedData | "EIP712Domain",
  >(
    params: RecoverTypedDataAddressParameters<TTypedData, TPrimaryType>
  ) => Effect.Effect<Address, SignatureRecoveryError>;

  readonly splitSignature: (signature: Hex) => Effect.Effect<
    {
      r: Hex;
      s: Hex;
      v: bigint;
    },
    InvalidSignatureError
  >;

  readonly joinSignature: (params: { r: Hex; s: Hex; v: bigint }) => Effect.Effect<Hex, never>;

  readonly hashMessage: (message: string | Uint8Array) => Effect.Effect<Hex, never>;

  readonly hashTypedData: <
    const TTypedData extends TypedData | Record<string, unknown>,
    TPrimaryType extends keyof TTypedData | "EIP712Domain",
  >(
    params: HashTypedDataParameters<TTypedData, TPrimaryType>
  ) => Effect.Effect<Hex, never>;
};

export class SignatureService extends Context.Service<SignatureService, SignatureServiceShape>()(
  "ew3/SignatureService"
) {}

export const SignatureServiceLive = Layer.succeed(
  SignatureService,
  SignatureService.of({
    hashMessage: (message) =>
      Effect.succeed(hashMessage(toSignableMessage(message))).pipe(
        Effect.withSpan(SpanNames.SIGNATURE_HASH_MESSAGE, {
          attributes: {},
        })
      ),

    hashTypedData: (params) =>
      Effect.succeed(hashTypedData(params)).pipe(
        Effect.withSpan(SpanNames.SIGNATURE_HASH_TYPED_DATA, {
          attributes: {
            primaryType: String(params.primaryType),
          },
        })
      ),

    joinSignature: (params) =>
      Effect.succeed(constructSignature(params)).pipe(
        Effect.withSpan(SpanNames.SIGNATURE_JOIN, {
          attributes: {},
        })
      ),

    recoverAddress: (params) =>
      Effect.gen(function* () {
        return yield* Effect.tryPromise({
          catch: (cause) =>
            new SignatureRecoveryError({
              cause,
              message: `Failed to recover address from message signature: ${cause}`,
              signature: params.signature,
            }),
          try: () =>
            recoverMessageAddress({
              message: toSignableMessage(params.message),
              signature: params.signature,
            }),
        });
      }).pipe(
        Effect.withSpan(SpanNames.SIGNATURE_RECOVER_ADDRESS, {
          attributes: {},
        })
      ),

    recoverTypedDataAddress: (params) =>
      Effect.gen(function* () {
        return yield* Effect.tryPromise({
          catch: (cause) =>
            new SignatureRecoveryError({
              cause,
              message: `Failed to recover address from typed data signature: ${cause}`,
              signature:
                typeof params.signature === "string" ? params.signature : String(params.signature),
            }),
          try: () => recoverTypedDataAddress(params),
        });
      }).pipe(
        Effect.withSpan(SpanNames.SIGNATURE_RECOVER_TYPED_DATA_ADDRESS, {
          attributes: {
            primaryType: String(params.primaryType),
          },
        })
      ),

    splitSignature: (signature) =>
      Effect.gen(function* () {
        if (!isValidSignature(signature)) {
          return yield* Effect.fail(
            new InvalidSignatureError({
              message: `Invalid signature format: expected 65 bytes (0x + 130 hex chars), got ${signature.length / 2 - 1} bytes`,
              signature,
            })
          );
        }

        return extractSignatureComponents(signature);
      }).pipe(
        Effect.withSpan(SpanNames.SIGNATURE_SPLIT, {
          attributes: {},
        })
      ),
    verifyMessage: (params) =>
      (isValidSignature(params.signature)
        ? Effect.tryPromise({
            catch: (cause) =>
              new SignatureVerificationError({
                cause,
                message: `Failed to verify message signature: ${cause}`,
                signature: params.signature,
              }),
            try: () =>
              verifyMessage({
                address: params.address,
                message: toSignableMessage(params.message),
                signature: params.signature,
              }),
          }).pipe(Effect.catch(() => Effect.succeed(false)))
        : Effect.succeed(false)
      ).pipe(
        Effect.withSpan(SpanNames.SIGNATURE_VERIFY_MESSAGE, {
          attributes: {
            address: params.address,
          },
        })
      ),

    verifyTypedData: (params) =>
      (typeof params.signature === "string" && !isValidSignature(params.signature as Hex)
        ? Effect.succeed(false)
        : Effect.tryPromise({
            catch: (cause) =>
              new SignatureVerificationError({
                cause,
                message: `Failed to verify typed data signature: ${cause}`,
                signature:
                  typeof params.signature === "string"
                    ? params.signature
                    : String(params.signature),
              }),
            try: () => verifyTypedData(params),
          }).pipe(Effect.catch(() => Effect.succeed(false)))
      ).pipe(
        Effect.withSpan(SpanNames.SIGNATURE_VERIFY_TYPED_DATA, {
          attributes: {
            address: params.address,
            primaryType: String(params.primaryType),
          },
        })
      ),
  })
);
