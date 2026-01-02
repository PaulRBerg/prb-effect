import { Effect } from "effect";
import type { Block } from "viem";
import type { PublicClientServiceShape } from "@/src/core/index.js";
import { fromWatchCallback } from "@/src/internal/index.js";
import { SpanNames } from "@/src/telemetry/index.js";
import { SubscriptionDroppedError } from "./errors.js";

export function watchBlocks(
  publicClientService: PublicClientServiceShape,
  params: {
    chainId: number;
    includeTransactions?: boolean;
    pollingInterval?: number;
  }
) {
  return Effect.gen(function* () {
    const client = yield* publicClientService.get(params.chainId);

    const stream = fromWatchCallback<Block, SubscriptionDroppedError>({
      mapError: (error) =>
        new SubscriptionDroppedError({
          chainId: params.chainId,
          message: `Block subscription dropped on chain ${params.chainId}: ${String(error)}`,
          subscriptionType: "blocks",
        }),
      watch: (cb) =>
        client.watchBlocks({
          emitOnBegin: true,
          includeTransactions: params.includeTransactions ?? false,
          onBlock: cb.onData,
          onError: cb.onError,
          pollingInterval: params.pollingInterval,
        }),
    });

    return stream;
  }).pipe(
    Effect.withSpan(SpanNames.SUBSCRIPTION_WATCH_BLOCKS, {
      attributes: {
        chainId: params.chainId,
        includeTransactions: params.includeTransactions ?? false,
        pollingInterval: params.pollingInterval,
      },
    })
  );
}
