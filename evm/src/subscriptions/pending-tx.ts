import { Effect } from "effect";
import type { Hash } from "viem";
import type { PublicClientServiceShape } from "@/src/core/index.js";
import { fromWatchCallback } from "@/src/internal/index.js";
import { SpanNames } from "@/src/telemetry/index.js";
import { SubscriptionDroppedError, SubscriptionNotSupportedError } from "./errors.js";

export function watchPendingTransactions(
  publicClientService: PublicClientServiceShape,
  params: {
    chainId: number;
    pollingInterval?: number;
  }
) {
  return Effect.gen(function* () {
    const client = yield* publicClientService.get(params.chainId);

    // Check if WebSocket is available - pending tx subscriptions typically require it
    if (client.transport.type !== "webSocket") {
      return yield* Effect.fail(
        new SubscriptionNotSupportedError({
          chainId: params.chainId,
          message: "Pending transaction subscriptions require WebSocket transport",
          subscriptionType: "pendingTransactions",
        })
      );
    }

    const stream = fromWatchCallback<Hash, SubscriptionDroppedError>({
      mapError: (error) =>
        new SubscriptionDroppedError({
          chainId: params.chainId,
          message: `Pending transaction subscription dropped on chain ${params.chainId}: ${String(error)}`,
          subscriptionType: "pendingTransactions",
        }),
      watch: (cb) =>
        client.watchPendingTransactions({
          onError: cb.onError,
          onTransactions: (hashes) => {
            for (const hash of hashes) {
              cb.onData(hash);
            }
          },
          pollingInterval: params.pollingInterval,
        }),
    });

    return stream;
  }).pipe(
    Effect.withSpan(SpanNames.SUBSCRIPTION_WATCH_PENDING_TX, {
      attributes: {
        chainId: params.chainId,
        pollingInterval: params.pollingInterval,
      },
    })
  );
}
