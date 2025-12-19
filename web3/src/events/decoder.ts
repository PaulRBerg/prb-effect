import { Array as Arr, Effect, Option } from "effect";
import type { Abi, Address, Hash, Log, TransactionReceipt } from "viem";
import { decodeEventLog } from "viem";
import { EventDecodeError } from "@/src/core/index.js";
import type { ContractEventArgs, ContractEventName } from "@/src/types/index.js";

export type DecodedEvent<TAbi extends Abi = Abi, TEventName extends string = string> = {
  eventName: TEventName;
  args: TEventName extends ContractEventName<TAbi>
    ? ContractEventArgs<TAbi, TEventName>
    : Record<string, unknown>;
  address: Address;
  blockNumber: bigint;
  transactionHash: Hash;
  logIndex: number;
  removed: boolean;
};

/** Try to decode a single log, returning Option */
export function tryDecodeLog<TAbi extends Abi>(
  log: Log,
  abi: TAbi
): Option.Option<DecodedEvent<TAbi, ContractEventName<TAbi>>> {
  try {
    const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics });
    return Option.some({
      address: log.address,
      args: decoded.args,
      blockNumber: log.blockNumber ?? 0n,
      eventName: decoded.eventName,
      logIndex: log.logIndex ?? 0,
      removed: log.removed ?? false,
      transactionHash: log.transactionHash ?? "0x",
    } as DecodedEvent<TAbi, ContractEventName<TAbi>>);
  } catch {
    return Option.none();
  }
}

/** Decode a single log or fail with EventDecodeError */
export const decodeLogOrFail = <TAbi extends Abi>(
  log: Log,
  abi: TAbi
): Effect.Effect<DecodedEvent<TAbi, ContractEventName<TAbi>>, EventDecodeError> => {
  const result = tryDecodeLog(log, abi);
  return Option.match(result, {
    onNone: () =>
      Effect.fail(
        new EventDecodeError({
          log,
          message: `Failed to decode log from ${log.address} at block ${log.blockNumber}`,
        })
      ),
    onSome: (event) => Effect.succeed(event),
  });
};

/** Decode all logs from a receipt */
export const decodeReceiptLogs = <TAbi extends Abi>(
  receipt: TransactionReceipt,
  abi: TAbi
): Effect.Effect<DecodedEvent<TAbi, ContractEventName<TAbi>>[], EventDecodeError> =>
  Effect.sync(() => Arr.getSomes(receipt.logs.map((log) => tryDecodeLog(log, abi))));

/** Decode logs and filter by event name */
export const decodeReceiptLogsByName = <
  TAbi extends Abi,
  TEventName extends ContractEventName<TAbi>,
>(
  receipt: TransactionReceipt,
  abi: TAbi,
  eventName: TEventName
): Effect.Effect<DecodedEvent<TAbi, TEventName>[], EventDecodeError> =>
  Effect.sync(() =>
    Arr.getSomes(receipt.logs.map((log) => tryDecodeLog(log, abi))).filter(
      (e): e is DecodedEvent<TAbi, TEventName> => e.eventName === eventName
    )
  );
