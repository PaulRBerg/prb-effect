import type { Stream } from "effect";
import { Context, Effect, Layer, Option } from "effect";
import type { Abi, Address, TransactionReceipt } from "viem";
import type { ClientNotFoundError, EventDecodeError } from "#src/core/index.js";
import { EventWatchError, PublicClientService } from "#src/core/index.js";
import type { DecodedEvent } from "#src/events/index.js";
import { decodeReceiptLogs, tryDecodeLog } from "#src/events/index.js";
import { fromWatchCallback } from "#src/internal/index.js";
import type { ContractEventName } from "#src/types/index.js";

export type WatchParams<TAbi extends Abi, TEventName extends ContractEventName<TAbi>> = {
  chainId: number;
  address?: Address;
  abi: TAbi;
  eventName: TEventName;
  fromBlock?: bigint;
  pollingInterval?: number;
};

export type EventStreamShape = {
  /**
   * Watch for events as a Stream
   */
  readonly watch: <TAbi extends Abi, TEventName extends ContractEventName<TAbi>>(
    params: WatchParams<TAbi, TEventName>
  ) => Effect.Effect<
    Stream.Stream<DecodedEvent<TAbi, TEventName>, EventWatchError>,
    ClientNotFoundError
  >;

  /**
   * Decode events from a transaction receipt
   */
  readonly decodeReceipt: <TAbi extends Abi>(
    receipt: TransactionReceipt,
    abi: TAbi
  ) => Effect.Effect<DecodedEvent<TAbi, ContractEventName<TAbi>>[], EventDecodeError>;
};

export class EventStream extends Context.Service<EventStream, EventStreamShape>()(
  "ew3/EventStream"
) {}

export const EventStreamLive = Layer.effect(
  EventStream,
  Effect.gen(function* () {
    const publicClientService = yield* PublicClientService;

    return {
      decodeReceipt: decodeReceiptLogs,
      watch: Effect.fn("EventStream.watch")(function* <
        TAbi extends Abi,
        TEventName extends ContractEventName<TAbi>,
      >(params: WatchParams<TAbi, TEventName>) {
        const client = yield* publicClientService.get(params.chainId);

        return fromWatchCallback<DecodedEvent<TAbi, TEventName>, EventWatchError>({
          mapError: (error) =>
            new EventWatchError({
              cause: error,
              chainId: params.chainId,
              message: `Event watch failed on chain ${params.chainId}`,
            }),
          watch: (cb) =>
            client.watchContractEvent({
              abi: params.abi,
              address: params.address,
              eventName: params.eventName,
              fromBlock: params.fromBlock,
              onError: cb.onError,
              pollingInterval: params.pollingInterval,
              onLogs: (logs) => {
                for (const log of logs) {
                  const decoded = tryDecodeLog(log, params.abi);
                  if (Option.isSome(decoded)) {
                    cb.onData(decoded.value as DecodedEvent<TAbi, TEventName>);
                  }
                }
              },
            }),
        });
      }),
    };
  })
);
