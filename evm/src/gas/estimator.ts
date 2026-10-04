import { Effect } from "effect";
import type { Address, Hex, PublicClient } from "viem";
import { publicActionsL2 } from "viem/op-stack";
import type { ClientNotFoundError } from "#src/core/errors/index.js";
import type { PublicClientServiceShape } from "#src/core/index.js";
import { GasPriceUnavailableError } from "#src/gas/errors.js";
import { isOpStackClient } from "#src/gas/op-stack.js";

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

/**
 * Type guard for missing base fee. Some chains (e.g., BNB Chain) report EIP-1559 support
 * inconsistently - the latest block may have `baseFeePerGas` while pending blocks do not.
 */
function isBaseFeeMissing(baseFee: bigint | null | undefined): baseFee is null | undefined {
  return baseFee === null || baseFee === undefined;
}

/**
 * Legacy fee estimation using `eth_gasPrice`. Used for chains without EIP-1559 support
 * (e.g., BNB Chain) or as a fallback when base fee is unavailable.
 */
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

export function hasL1DataFeeImpl(
  publicClientService: PublicClientServiceShape,
  chainId: number
): Effect.Effect<boolean, ClientNotFoundError> {
  return Effect.gen(function* () {
    const client = yield* publicClientService.get(chainId);
    return isOpStackClient(client);
  });
}

export function estimateL1FeeImpl(
  publicClientService: PublicClientServiceShape,
  chainId: number,
  params: {
    data?: Hex;
    from?: Address;
    to: Address;
    value?: bigint;
  }
): Effect.Effect<bigint, GasPriceUnavailableError | ClientNotFoundError> {
  return Effect.gen(function* () {
    const client = yield* publicClientService.get(chainId);
    if (!isOpStackClient(client)) {
      return 0n;
    }

    const opClient = client.extend(publicActionsL2());
    const request = {
      ...(params.from ? { account: params.from } : {}),
      ...(params.data === undefined ? {} : { data: params.data }),
      ...(params.value === undefined ? {} : { value: params.value }),
      chain: client.chain,
      to: params.to,
    } as Parameters<typeof opClient.estimateL1Fee>[0];

    return yield* Effect.tryPromise({
      catch: (cause) =>
        new GasPriceUnavailableError({
          cause,
          chainId,
          message: `Failed to estimate L1 data fee: ${String(cause)}`,
        }),
      try: () => opClient.estimateL1Fee(request),
    });
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
      // Try pending block first, fall back to latest for chains that don't support pending (L2s)
      const getPendingOrLatestBlock = Effect.tryPromise({
        catch: () => "pending-failed" as const,
        try: () => client.getBlock({ blockTag: "pending" }),
      }).pipe(
        Effect.catch(() =>
          Effect.tryPromise({
            catch: (cause) =>
              new GasPriceUnavailableError({
                cause,
                chainId,
                message: `Failed to get block for fee estimation: ${String(cause)}`,
              }),
            try: () => client.getBlock({ blockTag: "latest" }),
          })
        )
      );

      const [block, maxPriorityFeeResult] = yield* Effect.all(
        [
          getPendingOrLatestBlock,
          Effect.tryPromise(() => client.estimateMaxPriorityFeePerGas()).pipe(Effect.option),
        ],
        { concurrency: 2 }
      );

      // Fall back to legacy estimation if priority fee estimation is unsupported
      if (maxPriorityFeeResult._tag === "None") {
        return yield* getLegacyFeeEstimates(client, chainId);
      }

      const maxPriorityFeePerGas = maxPriorityFeeResult.value;

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

      // BNB Chain and similar networks may pass the EIP-1559 check but lack base fees
      // in practice. Fall back to legacy estimation when this occurs.
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
