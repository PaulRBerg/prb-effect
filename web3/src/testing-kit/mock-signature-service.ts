import type { Layer } from "effect";
import { Effect } from "effect";
import type { Address, Hex, TypedData, TypedDataDomain } from "viem";
import type {
  InvalidSignatureError,
  SignatureRecoveryError,
  SignatureServiceShape,
  SignatureVerificationError,
} from "@/src/signature/index.js";
import { SignatureService } from "@/src/signature/index.js";
import { makeMockServiceLayer } from "./helpers.js";

const DEFAULT_ADDRESS = "0x1234567890123456789012345678901234567890" as Address;
const DEFAULT_HASH = "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef" as Hex;

/**
 * Configuration for the mock SignatureService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockSignatureServiceConfig = {
  verifyMessage?: (params: {
    address: Address;
    message: string | Uint8Array;
    signature: Hex;
  }) => Effect.Effect<boolean, SignatureVerificationError>;

  verifyTypedData?: <
    const TTypedData extends TypedData,
    TPrimaryType extends keyof TTypedData,
  >(params: {
    address: Address;
    domain: TypedDataDomain;
    types: TTypedData;
    primaryType: TPrimaryType;
    message: Record<string, unknown>;
    signature: Hex;
  }) => Effect.Effect<boolean, SignatureVerificationError>;

  recoverAddress?: (params: {
    message: string | Uint8Array;
    signature: Hex;
  }) => Effect.Effect<Address, SignatureRecoveryError>;

  recoverTypedDataAddress?: <
    const TTypedData extends TypedData,
    TPrimaryType extends keyof TTypedData,
  >(params: {
    domain: TypedDataDomain;
    types: TTypedData;
    primaryType: TPrimaryType;
    message: Record<string, unknown>;
    signature: Hex;
  }) => Effect.Effect<Address, SignatureRecoveryError>;

  splitSignature?: (signature: Hex) => Effect.Effect<
    {
      r: Hex;
      s: Hex;
      v: bigint;
    },
    InvalidSignatureError
  >;

  joinSignature?: (params: { r: Hex; s: Hex; v: bigint }) => Effect.Effect<Hex, never>;

  hashMessage?: (message: string | Uint8Array) => Effect.Effect<Hex, never>;

  hashTypedData?: <
    const TTypedData extends TypedData,
    TPrimaryType extends keyof TTypedData,
  >(params: {
    domain: TypedDataDomain;
    types: TTypedData;
    primaryType: TPrimaryType;
    message: Record<string, unknown>;
  }) => Effect.Effect<Hex, never>;
};

const defaultConfig: Required<MockSignatureServiceConfig> = {
  hashMessage: (_message) => Effect.succeed(DEFAULT_HASH),
  hashTypedData: (_params) =>
    Effect.succeed(DEFAULT_HASH) as ReturnType<SignatureServiceShape["hashTypedData"]>,
  joinSignature: (_params) =>
    Effect.succeed(
      "0x1234567890123456789012345678901234567890123456789012345678901234abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd1b" as Hex
    ),
  recoverAddress: (_params) => Effect.succeed(DEFAULT_ADDRESS),
  recoverTypedDataAddress: (_params) =>
    Effect.succeed(DEFAULT_ADDRESS) as ReturnType<SignatureServiceShape["recoverTypedDataAddress"]>,
  splitSignature: (_signature) =>
    Effect.succeed({
      r: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
      s: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Hex,
      v: 27n,
    }),
  verifyMessage: (_params) => Effect.succeed(true),
  verifyTypedData: (_params) =>
    Effect.succeed(true) as ReturnType<SignatureServiceShape["verifyTypedData"]>,
};

/**
 * Creates a mock SignatureService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockSignatureServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockSignatureServiceLayer({
 *   verifyMessage: () => Effect.succeed(true),
 *   recoverAddress: () => Effect.succeed("0x..." as Address),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const signatureService = yield* SignatureService;
 *   const isValid = yield* signatureService.verifyMessage({
 *     address: "0x...",
 *     message: "Hello",
 *     signature: "0x...",
 *   });
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockSignatureServiceLayer = (
  config: MockSignatureServiceConfig = {}
): Layer.Layer<SignatureService> =>
  makeMockServiceLayer(SignatureService, defaultConfig, config, (merged) => ({
    hashMessage: merged.hashMessage,
    hashTypedData: merged.hashTypedData as SignatureServiceShape["hashTypedData"],
    joinSignature: merged.joinSignature,
    recoverAddress: merged.recoverAddress,
    recoverTypedDataAddress:
      merged.recoverTypedDataAddress as SignatureServiceShape["recoverTypedDataAddress"],
    splitSignature: merged.splitSignature,
    verifyMessage: merged.verifyMessage,
    verifyTypedData: merged.verifyTypedData as SignatureServiceShape["verifyTypedData"],
  }));
