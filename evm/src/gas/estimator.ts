import { Effect } from "effect";
import type { PublicClient } from "viem";
import type { ClientNotFoundError } from "@/src/core/errors/index.js";
import type { PublicClientServiceShape } from "@/src/core/index.js";
import { GasPriceUnavailableError } from "@/src/gas/errors.js";

export type GasSpeed = "slow" | "standard" | "fast" | "instant";

export type FeeEstimate = {
  confidence: number; // 0-100
  estimatedBaseFee: bigint;
  gasPrice?: bigint;
  maxFeePerGas: bigint;
  maxPriorityFeePerGas: bigint;
};

// Priority fee adjustments in gwei
const SPEED_ADJUSTMENTS: Record<GasSpeed, bigint> = {
  fast: 2_500_000_000n, // 2.5 gwei
  instant: 5_000_000_000n, // 5 gwei
  slow: 1_000_000_000n, // 1 gwei
  standard: 1_500_000_000n, // 1.5 gwei
};

// Confidence levels for each speed tier
const SPEED_CONFIDENCE: Record<GasSpeed, number> = {
  fast: 95,
  instant: 99,
  slow: 70,
  standard: 85,
};

function isBaseFeeMissing(baseFee: bigint | null | undefined): baseFee is null | undefined {
  return baseFee === null || baseFee === undefined;
}

function getLegacyFeeEstimates(
  client: PublicClient,
  chainId: number
): Effect.Effect<Record<GasSpeed, FeeEstimate>, GasPriceUnavailableError> {
  return Effect.gen(function* () {
    const gasPrice = yield* Effect.tryPromise({
      catch: (cause) =>
        new GasPriceUnavailableError({
          cause,
          chainId,
          message: `Failed to get gas price: ${String(cause)}`,
        }),
      try: () => client.getGasPrice(),
    });

    const estimates: Record<GasSpeed, FeeEstimate> = {
      fast: {
        confidence: SPEED_CONFIDENCE.fast,
        estimatedBaseFee: 0n,
        gasPrice: (gasPrice * 125n) / 100n, // 1.25x
        maxFeePerGas: (gasPrice * 125n) / 100n,
        maxPriorityFeePerGas: 0n,
      },
      instant: {
        confidence: SPEED_CONFIDENCE.instant,
        estimatedBaseFee: 0n,
        gasPrice: (gasPrice * 150n) / 100n, // 1.5x
        maxFeePerGas: (gasPrice * 150n) / 100n,
        maxPriorityFeePerGas: 0n,
      },
      slow: {
        confidence: SPEED_CONFIDENCE.slow,
        estimatedBaseFee: 0n,
        gasPrice: (gasPrice * 90n) / 100n, // 0.9x
        maxFeePerGas: (gasPrice * 90n) / 100n,
        maxPriorityFeePerGas: 0n,
      },
      standard: {
        confidence: SPEED_CONFIDENCE.standard,
        estimatedBaseFee: 0n,
        gasPrice,
        maxFeePerGas: gasPrice,
        maxPriorityFeePerGas: 0n,
      },
    };

    return estimates;
  });
}

export const supportsEip1559Impl = (
  publicClientService: PublicClientServiceShape,
  chainId: number
): Effect.Effect<boolean, GasPriceUnavailableError | ClientNotFoundError> =>
  Effect.gen(function* () {
    const client = yield* publicClientService.get(chainId);
    const block = yield* Effect.tryPromise({
      catch: (cause) =>
        new GasPriceUnavailableError({
          cause,
          chainId,
          message: `Failed to check EIP-1559 support: ${String(cause)}`,
        }),
      try: () => client.getBlock({ blockTag: "latest" }),
    });
    return block.baseFeePerGas !== null && block.baseFeePerGas !== undefined;
  });

export const getAllFeeEstimatesImpl = (
  publicClientService: PublicClientServiceShape,
  chainId: number
): Effect.Effect<Record<GasSpeed, FeeEstimate>, GasPriceUnavailableError | ClientNotFoundError> =>
  Effect.gen(function* () {
    const client = yield* publicClientService.get(chainId);
    const supportsEip1559 = yield* supportsEip1559Impl(publicClientService, chainId);

    if (supportsEip1559) {
      // EIP-1559 fee estimation
      const [block, maxPriorityFeePerGas] = yield* Effect.all(
        [
          Effect.tryPromise({
            catch: (cause) =>
              new GasPriceUnavailableError({
                cause,
                chainId,
                message: `Failed to get pending block: ${String(cause)}`,
              }),
            try: () => client.getBlock({ blockTag: "pending" }),
          }),
          Effect.tryPromise({
            catch: (cause) =>
              new GasPriceUnavailableError({
                cause,
                chainId,
                message: `Failed to estimate max priority fee: ${String(cause)}`,
              }),
            try: () => client.estimateMaxPriorityFeePerGas(),
          }),
        ],
        { concurrency: 2 }
      );

      let baseFee = block.baseFeePerGas;
      if (isBaseFeeMissing(baseFee)) {
        const latestBlock = yield* Effect.tryPromise({
          catch: (cause) =>
            new GasPriceUnavailableError({
              cause,
              chainId,
              message: `Failed to get latest block: ${String(cause)}`,
            }),
          try: () => client.getBlock({ blockTag: "latest" }),
        });
        baseFee = latestBlock.baseFeePerGas;
      }

      if (isBaseFeeMissing(baseFee)) {
        return yield* getLegacyFeeEstimates(client, chainId);
      }

      // Build estimates for each speed tier
      const makeEstimate = (speed: GasSpeed): FeeEstimate => {
        const priority = maxPriorityFeePerGas + SPEED_ADJUSTMENTS[speed];
        return {
          confidence: SPEED_CONFIDENCE[speed],
          estimatedBaseFee: baseFee,
          maxFeePerGas: baseFee * 2n + priority,
          maxPriorityFeePerGas: priority,
        };
      };

      const estimates: Record<GasSpeed, FeeEstimate> = {
        fast: makeEstimate("fast"),
        instant: makeEstimate("instant"),
        slow: makeEstimate("slow"),
        standard: makeEstimate("standard"),
      };

      return estimates;
    }

    return yield* getLegacyFeeEstimates(client, chainId);
  });
