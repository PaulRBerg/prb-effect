import { Effect } from "effect";
import type { Address, Hex, Log } from "viem";
import type { PublicClientServiceShape } from "#src/core/index.js";
import { fromWatchCallback } from "#src/internal/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import { SubscriptionDroppedError } from "./errors.js";

function matchesTopics(log: Log, topics: readonly (Hex | Hex[] | null)[]): boolean {
  return (
    log.topics.length >= topics.length &&
    topics.every((filter, index) => {
      if (filter === null) {
        return true;
      }
      const alternatives = typeof filter === "string" ? [filter] : filter;
      return (
        alternatives.length === 0 ||
        alternatives.some((topic) => topic.toLowerCase() === log.topics[index]?.toLowerCase())
      );
    })
  );
}

export function watchLogs(
  publicClientService: PublicClientServiceShape,
  params: {
    chainId: number;
    address?: Address | Address[];
    topics?: (Hex | Hex[] | null)[];
    pollingInterval?: number;
  }
) {
  return Effect.gen(function* () {
    const client = yield* publicClientService.get(params.chainId);

    const stream = fromWatchCallback<Log, SubscriptionDroppedError>({
      mapError: (error) =>
        new SubscriptionDroppedError({
          chainId: params.chainId,
          message: `Log subscription dropped on chain ${params.chainId}: ${String(error)}`,
          subscriptionType: "logs",
        }),
      watch: (cb) =>
        client.watchEvent({
          address: params.address,
          onError: cb.onError,
          pollingInterval: params.pollingInterval,
          onLogs: (logs) => {
            for (const log of logs) {
              if (matchesTopics(log, params.topics ?? [])) {
                cb.onData(log);
              }
            }
          },
        }),
    });

    return stream;
  }).pipe(
    Effect.withSpan(SpanNames.SUBSCRIPTION_WATCH_LOGS, {
      attributes: {
        address: params.address,
        chainId: params.chainId,
        pollingInterval: params.pollingInterval,
      },
    })
  );
}
