import { describe, expect, it } from "@effect/vitest";
import { Effect, Option } from "effect";
import type { Hex, Log, TransactionReceipt } from "viem";
import { encodeEventTopics, erc20Abi } from "viem";
import { EventDecodeError } from "@/src/core/index.js";
import {
  decodeLogOrFail,
  decodeReceiptLogs,
  decodeReceiptLogsByName,
  tryDecodeLog,
} from "@/src/events/index.js";
import { TEST_ADDRESS, TEST_ADDRESS_2, TEST_TX_HASH } from "@/src/testing-kit/index.js";

describe("tryDecodeLog", () => {
  it("returns Some(DecodedEvent) for valid Transfer event log", () => {
    const topics = encodeEventTopics({
      abi: erc20Abi,
      args: {
        from: TEST_ADDRESS,
        to: TEST_ADDRESS_2,
      },
      eventName: "Transfer",
    });

    const log: Log = {
      address: TEST_ADDRESS,
      blockHash: "0xblock",
      blockNumber: 12345n,
      data: "0x0000000000000000000000000000000000000000000000000000000000000064", // 100 in hex
      logIndex: 0,
      removed: false,
      topics: topics as [Hex, ...Hex[]],
      transactionHash: TEST_TX_HASH,
      transactionIndex: 0,
    };

    const result = tryDecodeLog(log, erc20Abi);
    expect(Option.isSome(result)).toBe(true);

    if (Option.isSome(result)) {
      const event = result.value;
      expect(event.eventName).toBe("Transfer");
      expect(event.address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
      expect(event.blockNumber).toBe(12345n);
      expect(event.transactionHash).toBe(TEST_TX_HASH);
      expect(event.logIndex).toBe(0);

      // Access args with type assertion since TypeScript can't narrow union types
      // based on eventName in conditional types
      const args = event.args as { from: string; to: string; value: bigint };
      expect(args.from.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
      expect(args.to.toLowerCase()).toBe(TEST_ADDRESS_2.toLowerCase());
      expect(args.value).toBe(100n);
    }
  });

  it("returns None for invalid/malformed log", () => {
    const log: Log = {
      address: TEST_ADDRESS,
      blockHash: "0xblock",
      blockNumber: 12345n,
      data: "0x",
      logIndex: 0,
      removed: false,
      topics: ["0xinvalid" as Hex], // Invalid topic
      transactionHash: TEST_TX_HASH,
      transactionIndex: 0,
    };

    const result = tryDecodeLog(log, erc20Abi);
    expect(Option.isNone(result)).toBe(true);
  });

  it("returns None for log with wrong ABI", () => {
    const topics = encodeEventTopics({
      abi: erc20Abi,
      args: {
        from: TEST_ADDRESS,
        to: TEST_ADDRESS_2,
      },
      eventName: "Transfer",
    });

    const log: Log = {
      address: TEST_ADDRESS,
      blockHash: "0xblock",
      blockNumber: 12345n,
      data: "0x0000000000000000000000000000000000000000000000000000000000000064",
      logIndex: 0,
      removed: false,
      topics: topics as [Hex, ...Hex[]],
      transactionHash: TEST_TX_HASH,
      transactionIndex: 0,
    };

    // Use a different ABI
    const wrongAbi = [
      {
        inputs: [
          { indexed: true, name: "owner", type: "address" },
          { indexed: true, name: "spender", type: "address" },
          { indexed: false, name: "value", type: "uint256" },
        ],
        name: "Approval",
        type: "event",
      },
    ] as const;

    const result = tryDecodeLog(log, wrongAbi);
    // Should return None because the topic doesn't match Approval event
    expect(Option.isNone(result)).toBe(true);
  });

  it("handles missing blockNumber gracefully (defaults to 0n)", () => {
    const topics = encodeEventTopics({
      abi: erc20Abi,
      args: {
        from: TEST_ADDRESS,
        to: TEST_ADDRESS_2,
      },
      eventName: "Transfer",
    });

    const log: Log = {
      address: TEST_ADDRESS,
      blockHash: "0xblock",
      blockNumber: null, // Missing blockNumber
      data: "0x0000000000000000000000000000000000000000000000000000000000000064",
      logIndex: 0,
      removed: false,
      topics: topics as [Hex, ...Hex[]],
      transactionHash: TEST_TX_HASH,
      transactionIndex: 0,
    };

    const result = tryDecodeLog(log, erc20Abi);
    expect(Option.isSome(result)).toBe(true);

    if (Option.isSome(result)) {
      const event = result.value;
      expect(event.blockNumber).toBe(0n);
    }
  });

  it("handles missing transactionHash gracefully", () => {
    const topics = encodeEventTopics({
      abi: erc20Abi,
      args: {
        from: TEST_ADDRESS,
        to: TEST_ADDRESS_2,
      },
      eventName: "Transfer",
    });

    const log: Log = {
      address: TEST_ADDRESS,
      blockHash: "0xblock",
      blockNumber: 12345n,
      data: "0x0000000000000000000000000000000000000000000000000000000000000064",
      logIndex: 0,
      removed: false,
      topics: topics as [Hex, ...Hex[]],
      transactionHash: null, // Missing transactionHash
      transactionIndex: 0,
    };

    const result = tryDecodeLog(log, erc20Abi);
    expect(Option.isSome(result)).toBe(true);

    if (Option.isSome(result)) {
      const event = result.value;
      expect(event.transactionHash).toBe("0x");
    }
  });
});

describe("decodeLogOrFail", () => {
  it.effect("decodes valid Transfer event log successfully", () =>
    Effect.gen(function* () {
      const topics = encodeEventTopics({
        abi: erc20Abi,
        args: {
          from: TEST_ADDRESS,
          to: TEST_ADDRESS_2,
        },
        eventName: "Transfer",
      });

      const log: Log = {
        address: TEST_ADDRESS,
        blockHash: "0xblock",
        blockNumber: 12345n,
        data: "0x0000000000000000000000000000000000000000000000000000000000000064", // 100 in hex
        logIndex: 0,
        removed: false,
        topics: topics as [Hex, ...Hex[]],
        transactionHash: TEST_TX_HASH,
        transactionIndex: 0,
      };

      const event = yield* decodeLogOrFail(log, erc20Abi);
      expect(event.eventName).toBe("Transfer");
      expect(event.address.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
      expect(event.blockNumber).toBe(12345n);
      expect(event.transactionHash).toBe(TEST_TX_HASH);
      expect(event.logIndex).toBe(0);

      const args = event.args as { from: string; to: string; value: bigint };
      expect(args.from.toLowerCase()).toBe(TEST_ADDRESS.toLowerCase());
      expect(args.to.toLowerCase()).toBe(TEST_ADDRESS_2.toLowerCase());
      expect(args.value).toBe(100n);
    })
  );

  it.effect("fails with EventDecodeError for invalid log", () =>
    Effect.gen(function* () {
      const log: Log = {
        address: TEST_ADDRESS,
        blockHash: "0xblock",
        blockNumber: 12345n,
        data: "0x",
        logIndex: 0,
        removed: false,
        topics: ["0xinvalid" as Hex], // Invalid topic
        transactionHash: TEST_TX_HASH,
        transactionIndex: 0,
      };

      const result = yield* Effect.either(decodeLogOrFail(log, erc20Abi));
      expect(result._tag).toBe("Left");

      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(EventDecodeError);
        expect(result.left.message).toContain("Failed to decode log");
        expect(result.left.message).toContain(TEST_ADDRESS);
        expect(result.left.message).toContain("12345");
      }
    })
  );

  it.effect("fails with EventDecodeError for log with wrong ABI", () =>
    Effect.gen(function* () {
      const topics = encodeEventTopics({
        abi: erc20Abi,
        args: {
          from: TEST_ADDRESS,
          to: TEST_ADDRESS_2,
        },
        eventName: "Transfer",
      });

      const log: Log = {
        address: TEST_ADDRESS,
        blockHash: "0xblock",
        blockNumber: 12345n,
        data: "0x0000000000000000000000000000000000000000000000000000000000000064",
        logIndex: 0,
        removed: false,
        topics: topics as [Hex, ...Hex[]],
        transactionHash: TEST_TX_HASH,
        transactionIndex: 0,
      };

      // Use a different ABI
      const wrongAbi = [
        {
          inputs: [
            { indexed: true, name: "owner", type: "address" },
            { indexed: true, name: "spender", type: "address" },
            { indexed: false, name: "value", type: "uint256" },
          ],
          name: "Approval",
          type: "event",
        },
      ] as const;

      const result = yield* Effect.either(decodeLogOrFail(log, wrongAbi));
      expect(result._tag).toBe("Left");

      if (result._tag === "Left") {
        expect(result.left).toBeInstanceOf(EventDecodeError);
      }
    })
  );
});

describe("decodeReceiptLogs", () => {
  it.effect("decodes all matching logs from receipt", () =>
    Effect.gen(function* () {
      const topics1 = encodeEventTopics({
        abi: erc20Abi,
        args: {
          from: TEST_ADDRESS,
          to: TEST_ADDRESS_2,
        },
        eventName: "Transfer",
      });

      const topics2 = encodeEventTopics({
        abi: erc20Abi,
        args: {
          from: TEST_ADDRESS_2,
          to: TEST_ADDRESS,
        },
        eventName: "Transfer",
      });

      const receipt: TransactionReceipt = {
        blockHash: "0xblock",
        blockNumber: 12345n,
        contractAddress: null,
        cumulativeGasUsed: 100000n,
        effectiveGasPrice: 1000000000n,
        from: TEST_ADDRESS,
        gasUsed: 50000n,
        logs: [
          {
            address: TEST_ADDRESS,
            blockHash: "0xblock",
            blockNumber: 12345n,
            data: "0x0000000000000000000000000000000000000000000000000000000000000064",
            logIndex: 0,
            removed: false,
            topics: topics1 as [Hex, ...Hex[]],
            transactionHash: TEST_TX_HASH,
            transactionIndex: 0,
          },
          {
            address: TEST_ADDRESS,
            blockHash: "0xblock",
            blockNumber: 12345n,
            data: "0x0000000000000000000000000000000000000000000000000000000000000032",
            logIndex: 1,
            removed: false,
            topics: topics2 as [Hex, ...Hex[]],
            transactionHash: TEST_TX_HASH,
            transactionIndex: 0,
          },
        ],
        logsBloom: "0x",
        status: "success",
        to: TEST_ADDRESS_2,
        transactionHash: TEST_TX_HASH,
        transactionIndex: 0,
        type: "eip1559",
      };

      const events = yield* decodeReceiptLogs(receipt, erc20Abi);
      expect(events).toHaveLength(2);
      expect(events[0].eventName).toBe("Transfer");
      expect(events[0].logIndex).toBe(0);
      expect(events[1].eventName).toBe("Transfer");
      expect(events[1].logIndex).toBe(1);
    })
  );

  it.effect("filters out non-matching logs", () =>
    Effect.gen(function* () {
      const topics1 = encodeEventTopics({
        abi: erc20Abi,
        args: {
          from: TEST_ADDRESS,
          to: TEST_ADDRESS_2,
        },
        eventName: "Transfer",
      });

      const receipt: TransactionReceipt = {
        blockHash: "0xblock",
        blockNumber: 12345n,
        contractAddress: null,
        cumulativeGasUsed: 100000n,
        effectiveGasPrice: 1000000000n,
        from: TEST_ADDRESS,
        gasUsed: 50000n,
        logs: [
          {
            address: TEST_ADDRESS,
            blockHash: "0xblock",
            blockNumber: 12345n,
            data: "0x0000000000000000000000000000000000000000000000000000000000000064",
            logIndex: 0,
            removed: false,
            topics: topics1 as [Hex, ...Hex[]],
            transactionHash: TEST_TX_HASH,
            transactionIndex: 0,
          },
          {
            address: TEST_ADDRESS,
            blockHash: "0xblock",
            blockNumber: 12345n,
            data: "0x",
            logIndex: 1,
            removed: false,
            topics: ["0xinvalid" as Hex], // Invalid log
            transactionHash: TEST_TX_HASH,
            transactionIndex: 0,
          },
        ],
        logsBloom: "0x",
        status: "success",
        to: TEST_ADDRESS_2,
        transactionHash: TEST_TX_HASH,
        transactionIndex: 0,
        type: "eip1559",
      };

      const events = yield* decodeReceiptLogs(receipt, erc20Abi);
      expect(events).toHaveLength(1);
      expect(events[0].eventName).toBe("Transfer");
    })
  );

  it.effect("returns empty array for receipt with no matching logs", () =>
    Effect.gen(function* () {
      const receipt: TransactionReceipt = {
        blockHash: "0xblock",
        blockNumber: 12345n,
        contractAddress: null,
        cumulativeGasUsed: 100000n,
        effectiveGasPrice: 1000000000n,
        from: TEST_ADDRESS,
        gasUsed: 50000n,
        logs: [
          {
            address: TEST_ADDRESS,
            blockHash: "0xblock",
            blockNumber: 12345n,
            data: "0x",
            logIndex: 0,
            removed: false,
            topics: ["0xinvalid" as Hex],
            transactionHash: TEST_TX_HASH,
            transactionIndex: 0,
          },
        ],
        logsBloom: "0x",
        status: "success",
        to: TEST_ADDRESS_2,
        transactionHash: TEST_TX_HASH,
        transactionIndex: 0,
        type: "eip1559",
      };

      const events = yield* decodeReceiptLogs(receipt, erc20Abi);
      expect(events).toHaveLength(0);
    })
  );
});

describe("decodeReceiptLogsByName", () => {
  it.effect("filters decoded logs by event name", () =>
    Effect.gen(function* () {
      const transferTopics = encodeEventTopics({
        abi: erc20Abi,
        args: {
          from: TEST_ADDRESS,
          to: TEST_ADDRESS_2,
        },
        eventName: "Transfer",
      });

      // Create an Approval event log (even though we don't have it in simplified erc20Abi,
      // we'll use it for testing purposes)
      const extendedAbi = [
        ...erc20Abi,
        {
          inputs: [
            { indexed: true, name: "owner", type: "address" },
            { indexed: true, name: "spender", type: "address" },
            { indexed: false, name: "value", type: "uint256" },
          ],
          name: "Approval",
          type: "event",
        },
      ] as const;

      const approvalTopics = encodeEventTopics({
        abi: extendedAbi,
        args: {
          owner: TEST_ADDRESS,
          spender: TEST_ADDRESS_2,
        },
        eventName: "Approval",
      });

      const receipt: TransactionReceipt = {
        blockHash: "0xblock",
        blockNumber: 12345n,
        contractAddress: null,
        cumulativeGasUsed: 100000n,
        effectiveGasPrice: 1000000000n,
        from: TEST_ADDRESS,
        gasUsed: 50000n,
        logs: [
          {
            address: TEST_ADDRESS,
            blockHash: "0xblock",
            blockNumber: 12345n,
            data: "0x0000000000000000000000000000000000000000000000000000000000000064",
            logIndex: 0,
            removed: false,
            topics: transferTopics as [Hex, ...Hex[]],
            transactionHash: TEST_TX_HASH,
            transactionIndex: 0,
          },
          {
            address: TEST_ADDRESS,
            blockHash: "0xblock",
            blockNumber: 12345n,
            data: "0x0000000000000000000000000000000000000000000000000000000000000032",
            logIndex: 1,
            removed: false,
            topics: approvalTopics as [Hex, ...Hex[]],
            transactionHash: TEST_TX_HASH,
            transactionIndex: 0,
          },
        ],
        logsBloom: "0x",
        status: "success",
        to: TEST_ADDRESS_2,
        transactionHash: TEST_TX_HASH,
        transactionIndex: 0,
        type: "eip1559",
      };

      const transferEvents = yield* decodeReceiptLogsByName(receipt, extendedAbi, "Transfer");
      expect(transferEvents).toHaveLength(1);
      expect(transferEvents[0].eventName).toBe("Transfer");
      expect(transferEvents[0].logIndex).toBe(0);

      const approvalEvents = yield* decodeReceiptLogsByName(receipt, extendedAbi, "Approval");
      expect(approvalEvents).toHaveLength(1);
      expect(approvalEvents[0].eventName).toBe("Approval");
      expect(approvalEvents[0].logIndex).toBe(1);
    })
  );

  it.effect("returns empty array when no logs match event name", () =>
    Effect.gen(function* () {
      const topics = encodeEventTopics({
        abi: erc20Abi,
        args: {
          from: TEST_ADDRESS,
          to: TEST_ADDRESS_2,
        },
        eventName: "Transfer",
      });

      const receipt: TransactionReceipt = {
        blockHash: "0xblock",
        blockNumber: 12345n,
        contractAddress: null,
        cumulativeGasUsed: 100000n,
        effectiveGasPrice: 1000000000n,
        from: TEST_ADDRESS,
        gasUsed: 50000n,
        logs: [
          {
            address: TEST_ADDRESS,
            blockHash: "0xblock",
            blockNumber: 12345n,
            data: "0x0000000000000000000000000000000000000000000000000000000000000064",
            logIndex: 0,
            removed: false,
            topics: topics as [Hex, ...Hex[]],
            transactionHash: TEST_TX_HASH,
            transactionIndex: 0,
          },
        ],
        logsBloom: "0x",
        status: "success",
        to: TEST_ADDRESS_2,
        transactionHash: TEST_TX_HASH,
        transactionIndex: 0,
        type: "eip1559",
      };

      const events = yield* decodeReceiptLogsByName(receipt, erc20Abi, "Approval");
      expect(events).toHaveLength(0);
    })
  );
});
