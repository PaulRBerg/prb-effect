/**
 * Safe multisig detection using EXTCODEHASH comparisons.
 *
 * Determines if an address is a Safe multisig by comparing bytecode hashes
 * against known Safe proxy and singleton hashes.
 *
 * @see https://github.com/safe-fndn/safe-smart-account/issues/714
 */

import type { ClientNotFoundError } from "@prb/effect-evm/core";
import { PublicClientService } from "@prb/effect-evm/core";
import { Effect, Schema } from "effect";
import type { Address, Hex } from "viem";
import { keccak256 } from "viem";

// -----------------------------------------------------------------------------
// Known Safe bytecode hashes
// -----------------------------------------------------------------------------

/**
 * Known Safe proxy bytecode hashes (keccak256 of deployed bytecode).
 *
 * These are the proxy contracts that delegate to Safe singletons.
 * All Safe accounts use one of these proxy implementations.
 *
 * @see https://github.com/safe-global/safe-deployments
 */
const KNOWN_SAFE_PROXY_HASHES: ReadonlySet<Hex> = new Set([
  // SafeProxy v1.3.0
  "0xb89c1b3bdf2cf8827818646bce9a8f6e372885f8c55e5c07acbd307cb133b000",
  // SafeProxy v1.4.1
  "0xd7d408ebcd99b2b70be43e20253d6d92a8ea8fab29bd3be7f55b10032331fb4c",
] as Hex[]);

/**
 * Known Safe singleton (implementation) bytecode hashes.
 *
 * These are the actual Safe contract implementations that proxies delegate to.
 *
 * Derivation: `cast keccak $(cast code <address> --rpc-url <mainnet>)`
 *
 * @see https://github.com/safe-global/safe-deployments
 */
const KNOWN_SAFE_SINGLETON_HASHES: ReadonlySet<Hex> = new Set([
  // Safe v1.0.0
  "0xe1f1593df76e69abc2d692792c80f329457551d5e83dde597546a1d58764da80",
  // Safe v1.1.1
  "0x56b8be58b5ad629a621593a2e5e5e8e9a28408dc06e95597497b303902772e45",
  // Safe v1.2.0
  "0x2ae2d1231f0d754a7fa4f5e5d0e5554085e1b500d8e09f95aaaaa3f49c0db922",
  // Safe v1.3.0
  "0xbba688fbdb21ad2bb58bc320638b43d94e7d100f6f3ebaab0a4e4de6304b1c2e",
  // Safe v1.3.0 L2
  "0x21842597390c4c6e3c1239e434a682b054bd9548eee5e9b1d6a4482731023c0f",
  // Safe v1.4.1
  "0x1fe2df852ba3299d6534ef416eefa406e56ced995bca886ab7a553e6d0c5e1c4",
  // Safe v1.4.1 L2
  "0xb1f926978a0f44a2c0ec8fe822418ae969bd8c3f18d61e5103100339894f81ff",
  // Safe v1.5.0
  "0xdda019cbd7c867a533a2a86e5c53434fdc50b13122b5a5ddb4a8df61b31c20f2",
  // Safe v1.5.0 L2
  "0x180193227186ccb85316c94db1f0d156ed932b14712cfaac78901899178572dc",
] as Hex[]);

// -----------------------------------------------------------------------------
// Errors
// -----------------------------------------------------------------------------

export class SafeMultisigDetectionError extends Schema.TaggedError<SafeMultisigDetectionError>()(
  "SafeMultisigDetectionError",
  {
    address: Schema.String,
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
  }
) {}

// -----------------------------------------------------------------------------
// ABI for masterCopy() call
// -----------------------------------------------------------------------------

const masterCopyAbi = [
  {
    inputs: [],
    name: "masterCopy",
    outputs: [{ name: "", type: "address" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

// -----------------------------------------------------------------------------
// Detection function
// -----------------------------------------------------------------------------

export type SafeDetectionParams = {
  /** The address to check */
  address: Address;
  /** The chain ID to query */
  chainId: number;
};

export type SafeDetectionResult = {
  /** Whether the address appears to be a Safe multisig */
  isSafe: boolean;
  /** The proxy bytecode hash (if contract exists) */
  proxyHash: Hex | undefined;
  /** The singleton address (if Safe proxy detected) */
  singletonAddress: Address | undefined;
  /** The singleton bytecode hash (if singleton found) */
  singletonHash: Hex | undefined;
};

/**
 * Check if an address is a Safe multisig by comparing EXTCODEHASH values.
 *
 * This function:
 * 1. Gets the bytecode of the target address and computes its hash
 * 2. Checks if the hash matches a known Safe proxy
 * 3. If proxy matches, calls `masterCopy()` to get the singleton address
 * 4. Verifies the singleton's bytecode hash matches a known Safe singleton
 *
 * @example
 * ```typescript
 * const result = yield* isSafeMultisig({
 *   address: "0x...",
 *   chainId: 1,
 * });
 *
 * if (result.isSafe) {
 *   console.log("This is a Safe multisig!");
 * }
 * ```
 *
 * @remarks
 * This is a heuristic check, not a guarantee. Any contract can technically
 * deploy bytecode that matches Safe's, though this is extremely unlikely
 * in practice. For most use cases, this provides sufficient confidence.
 *
 * @see https://github.com/safe-fndn/safe-smart-account/issues/714
 */
export function isSafeMultisig(
  params: SafeDetectionParams
): Effect.Effect<
  SafeDetectionResult,
  SafeMultisigDetectionError | ClientNotFoundError,
  PublicClientService
> {
  return Effect.gen(function* () {
    const { address, chainId } = params;
    const publicClientService = yield* PublicClientService;
    const client = yield* publicClientService.get(chainId);

    // 1. Get proxy bytecode
    const proxyBytecode = yield* Effect.tryPromise({
      catch: (cause) =>
        new SafeMultisigDetectionError({
          address,
          cause,
          message: `Failed to get bytecode for ${address}`,
        }),
      try: () => client.getCode({ address }),
    });

    // No bytecode = EOA or empty contract
    if (!proxyBytecode || proxyBytecode === "0x") {
      return {
        isSafe: false,
        proxyHash: undefined,
        singletonAddress: undefined,
        singletonHash: undefined,
      };
    }

    // 2. Compute proxy hash
    const proxyHash = keccak256(proxyBytecode);

    // 3. Check if proxy hash matches known Safe proxies
    if (!KNOWN_SAFE_PROXY_HASHES.has(proxyHash)) {
      return {
        isSafe: false,
        proxyHash,
        singletonAddress: undefined,
        singletonHash: undefined,
      };
    }

    // 4. Call masterCopy() to get singleton address
    const singletonAddress = yield* Effect.tryPromise({
      catch: (cause) =>
        new SafeMultisigDetectionError({
          address,
          cause,
          message: `Failed to call masterCopy() on ${address}`,
        }),
      try: () =>
        client.readContract({
          abi: masterCopyAbi,
          address,
          functionName: "masterCopy",
        }),
    });

    // 5. Get singleton bytecode
    const singletonBytecode = yield* Effect.tryPromise({
      catch: (cause) =>
        new SafeMultisigDetectionError({
          address,
          cause,
          message: `Failed to get bytecode for singleton ${singletonAddress}`,
        }),
      try: () => client.getCode({ address: singletonAddress }),
    });

    if (!singletonBytecode || singletonBytecode === "0x") {
      return {
        isSafe: false,
        proxyHash,
        singletonAddress,
        singletonHash: undefined,
      };
    }

    // 6. Compute and check singleton hash
    const singletonHash = keccak256(singletonBytecode);
    const isSafe = KNOWN_SAFE_SINGLETON_HASHES.has(singletonHash);

    return {
      isSafe,
      proxyHash,
      singletonAddress,
      singletonHash,
    };
  });
}
