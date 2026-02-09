import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Address, Hex } from "viem";
import { mainnet } from "viem/chains";
import { MIN_TX_GAS } from "#src/constants/index.js";
import type { SimulationResult } from "#src/simulation/index.js";
import { SimulationService } from "#src/simulation/index.js";
import { makeMockSimulationServiceLayer } from "#src/testing-kit/index.js";

describe("testing-kit: makeMockSimulationServiceLayer", () => {
  describe("simulate", () => {
    it.effect("returns SimulationResult", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result = yield* service.simulate({
          chainId: mainnet.id,
          from: "0x1234567890123456789012345678901234567890" as Address,
          to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        });

        expect(result).toHaveProperty("success");
        expect(result).toHaveProperty("gasUsed");
        expect(result).toHaveProperty("gasLimit");
        expect(result).toHaveProperty("logs");
        expect(result).toHaveProperty("stateDiff");
        expect(typeof result.success).toBe("boolean");
        expect(typeof result.gasUsed).toBe("bigint");
        expect(typeof result.gasLimit).toBe("bigint");
        expect(Array.isArray(result.logs)).toBe(true);
        expect(Array.isArray(result.stateDiff)).toBe(true);
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("accepts optional parameters", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result = yield* service.simulate({
          blockNumber: 1000n,
          chainId: mainnet.id,
          data: "0x12345678" as Hex,
          from: "0x1234567890123456789012345678901234567890" as Address,
          gas: 100000n,
          to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
          value: 1000n,
        });

        expect(result.success).toBe(true);
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("returns success field", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result = yield* service.simulate({
          chainId: mainnet.id,
          from: "0x1234567890123456789012345678901234567890" as Address,
          to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        });

        expect(result.success).toBe(true);
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("returns gasUsed field", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result = yield* service.simulate({
          chainId: mainnet.id,
          from: "0x1234567890123456789012345678901234567890" as Address,
          to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        });

        expect(result.gasUsed).toBe(MIN_TX_GAS);
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("returns logs array", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result = yield* service.simulate({
          chainId: mainnet.id,
          from: "0x1234567890123456789012345678901234567890" as Address,
          to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        });

        expect(Array.isArray(result.logs)).toBe(true);
        expect(result.logs.length).toBe(0);
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("returns stateDiff array", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result = yield* service.simulate({
          chainId: mainnet.id,
          from: "0x1234567890123456789012345678901234567890" as Address,
          to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        });

        expect(Array.isArray(result.stateDiff)).toBe(true);
        expect(result.stateDiff.length).toBe(0);
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("fails with error for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const exit = yield* Effect.exit(
          service.simulate({
            chainId: 123_456_789,
            from: "0x1234567890123456789012345678901234567890" as Address,
            to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
          })
        );

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(makeMockSimulationServiceLayer({}, 1)))
    );

    it.effect("uses custom implementation when configured", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result = yield* service.simulate({
          chainId: mainnet.id,
          from: "0x1234567890123456789012345678901234567890" as Address,
          to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
        });

        expect(result.gasUsed).toBe(50000n);
        expect(result.logs.length).toBe(1);
      }).pipe(
        Effect.provide(
          makeMockSimulationServiceLayer({
            simulate: () =>
              Effect.succeed({
                gasLimit: 100000n,
                gasUsed: 50000n,
                logs: [
                  {
                    address: "0x1234567890123456789012345678901234567890" as Address,
                    data: "0x",
                    topics: [],
                  },
                ],
                stateDiff: [],
                success: true,
              }),
          })
        )
      )
    );
  });

  describe("simulateBundle", () => {
    it.effect("returns array of SimulationResult", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const results = yield* service.simulateBundle({
          chainId: mainnet.id,
          transactions: [
            {
              from: "0x1234567890123456789012345678901234567890" as Address,
              to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
            },
            {
              from: "0x1234567890123456789012345678901234567890" as Address,
              to: "0x9876543210987654321098765432109876543210" as Address,
            },
          ],
        });

        expect(Array.isArray(results)).toBe(true);
        expect(results.length).toBe(2);
        for (const result of results) {
          expect(result).toHaveProperty("success");
          expect(result).toHaveProperty("gasUsed");
          expect(result).toHaveProperty("gasLimit");
        }
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("accepts optional blockNumber parameter", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const results = yield* service.simulateBundle({
          blockNumber: 1000n,
          chainId: mainnet.id,
          transactions: [
            {
              from: "0x1234567890123456789012345678901234567890" as Address,
              to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
            },
          ],
        });

        expect(results.length).toBe(1);
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("fails with error for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const exit = yield* Effect.exit(
          service.simulateBundle({
            chainId: 123_456_789,
            transactions: [
              {
                from: "0x1234567890123456789012345678901234567890" as Address,
                to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
              },
            ],
          })
        );

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(makeMockSimulationServiceLayer({}, 1)))
    );

    it.effect("uses custom implementation when configured", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const results = yield* service.simulateBundle({
          chainId: mainnet.id,
          transactions: [
            {
              from: "0x1234567890123456789012345678901234567890" as Address,
              to: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
            },
          ],
        });

        expect(results.length).toBe(1);
        expect(results[0].gasUsed).toBe(100000n);
      }).pipe(
        Effect.provide(
          makeMockSimulationServiceLayer({
            simulateBundle: () =>
              Effect.succeed([
                {
                  gasLimit: 200000n,
                  gasUsed: 100000n,
                  logs: [],
                  stateDiff: [],
                  success: true,
                },
              ]),
          })
        )
      )
    );
  });

  describe("getReadableSummary", () => {
    it.effect("returns string", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result: SimulationResult = {
          gasLimit: 100000n,
          gasUsed: 50000n,
          logs: [],
          stateDiff: [],
          success: true,
        };

        const summary = yield* service.getReadableSummary(result);

        expect(typeof summary).toBe("string");
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("includes status in summary", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result: SimulationResult = {
          gasLimit: 100000n,
          gasUsed: 50000n,
          logs: [],
          stateDiff: [],
          success: true,
        };

        const summary = yield* service.getReadableSummary(result);

        expect(summary).toContain("Status:");
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("includes gas information in summary", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result: SimulationResult = {
          gasLimit: 100000n,
          gasUsed: 50000n,
          logs: [],
          stateDiff: [],
          success: true,
        };

        const summary = yield* service.getReadableSummary(result);

        expect(summary).toContain("Gas:");
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("accepts optional abi parameter", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result: SimulationResult = {
          gasLimit: 100000n,
          gasUsed: 50000n,
          logs: [],
          stateDiff: [],
          success: true,
        };
        const abi = [
          {
            inputs: [],
            name: "test",
            outputs: [],
            stateMutability: "nonpayable",
            type: "function",
          },
        ] as const;

        const summary = yield* service.getReadableSummary(result, abi);

        expect(typeof summary).toBe("string");
      }).pipe(Effect.provide(makeMockSimulationServiceLayer()))
    );

    it.effect("uses custom implementation when configured", () =>
      Effect.gen(function* () {
        const service = yield* SimulationService;
        const result: SimulationResult = {
          gasLimit: 100000n,
          gasUsed: 50000n,
          logs: [],
          stateDiff: [],
          success: true,
        };

        const summary = yield* service.getReadableSummary(result);

        expect(summary).toBe("Custom summary");
      }).pipe(
        Effect.provide(
          makeMockSimulationServiceLayer({
            getReadableSummary: () => Effect.succeed("Custom summary"),
          })
        )
      )
    );
  });
});
