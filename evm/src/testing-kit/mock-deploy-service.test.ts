import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Address, Hex } from "viem";
import { mainnet } from "viem/chains";
import { MIN_TX_GAS } from "#src/constants/index.js";
import { DeployService } from "#src/deploy/index.js";
import { makeMockDeployServiceLayer } from "#src/testing-kit/index.js";

const MOCK_ABI = [
  {
    inputs: [],
    name: "test",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const MOCK_BYTECODE = "0x608060405234801561001057600080fd5b50" as Hex;

describe("testing-kit: makeMockDeployServiceLayer", () => {
  describe("deploy", () => {
    it.effect("returns DeployResult with hash, address, receipt, and deployedBytecode", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const result = yield* service.deploy({
          abi: MOCK_ABI,
          bytecode: MOCK_BYTECODE,
          chainId: mainnet.id,
        });

        expect(result).toHaveProperty("hash");
        expect(result).toHaveProperty("address");
        expect(result).toHaveProperty("receipt");
        expect(result).toHaveProperty("deployedBytecode");
        expect(typeof result.hash).toBe("string");
        expect(typeof result.address).toBe("string");
        expect(typeof result.deployedBytecode).toBe("string");
        expect(result.receipt.status).toBe("success");
      }).pipe(Effect.provide(makeMockDeployServiceLayer()))
    );

    it.effect("accepts optional parameters", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const result = yield* service.deploy({
          abi: MOCK_ABI,
          account: "0x1234567890123456789012345678901234567890" as Address,
          args: ["test"],
          bytecode: MOCK_BYTECODE,
          chainId: mainnet.id,
          gas: 100000n,
          value: 1000n,
        });

        expect(result).toHaveProperty("hash");
        expect(result).toHaveProperty("address");
      }).pipe(Effect.provide(makeMockDeployServiceLayer()))
    );

    it.effect("fails with error for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const exit = yield* Effect.exit(
          service.deploy({
            abi: MOCK_ABI,
            bytecode: MOCK_BYTECODE,
            chainId: 123_456_789,
          })
        );

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(makeMockDeployServiceLayer({}, 1)))
    );

    it.effect("uses custom deploy implementation when configured", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const result = yield* service.deploy({
          abi: MOCK_ABI,
          bytecode: MOCK_BYTECODE,
          chainId: mainnet.id,
        });

        expect(result.address).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
      }).pipe(
        Effect.provide(
          makeMockDeployServiceLayer({
            deploy: () =>
              Effect.succeed({
                address: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
                deployedBytecode: MOCK_BYTECODE,
                hash: "0xhash" as Hex,
                receipt: {
                  blockHash: "0xblockhash",
                  blockNumber: 1000n,
                  contractAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address,
                  cumulativeGasUsed: MIN_TX_GAS,
                  effectiveGasPrice: 1000000000n,
                  from: "0x1234567890123456789012345678901234567890",
                  gasUsed: MIN_TX_GAS,
                  logs: [],
                  logsBloom: "0x00",
                  status: "success",
                  to: null,
                  transactionHash: "0xhash",
                  transactionIndex: 0,
                  type: "eip1559",
                },
              }),
          })
        )
      )
    );
  });

  describe("computeAddress", () => {
    it.effect("computes address from sender and nonce", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const address = yield* service.computeAddress({
          from: "0x1234567890123456789012345678901234567890" as Address,
          nonce: 5n,
        });

        expect(typeof address).toBe("string");
        expect(address.startsWith("0x")).toBe(true);
        expect(address.length).toBe(42);
      }).pipe(Effect.provide(makeMockDeployServiceLayer()))
    );

    it.effect("uses custom implementation when configured", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const address = yield* service.computeAddress({
          from: "0x1234567890123456789012345678901234567890" as Address,
          nonce: 5n,
        });

        expect(address).toBe("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
      }).pipe(
        Effect.provide(
          makeMockDeployServiceLayer({
            computeAddress: () =>
              Effect.succeed("0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address),
          })
        )
      )
    );
  });

  describe("verifyDeployment", () => {
    it.effect("returns boolean", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const verified = yield* service.verifyDeployment({
          address: "0x1234567890123456789012345678901234567890" as Address,
          chainId: mainnet.id,
        });

        expect(typeof verified).toBe("boolean");
      }).pipe(Effect.provide(makeMockDeployServiceLayer()))
    );

    it.effect("returns true by default", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const verified = yield* service.verifyDeployment({
          address: "0x1234567890123456789012345678901234567890" as Address,
          chainId: mainnet.id,
        });

        expect(verified).toBe(true);
      }).pipe(Effect.provide(makeMockDeployServiceLayer()))
    );

    it.effect("fails with error for unsupported chainId", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const exit = yield* Effect.exit(
          service.verifyDeployment({
            address: "0x1234567890123456789012345678901234567890" as Address,
            chainId: 123_456_789,
          })
        );

        expect(exit._tag).toBe("Failure");
      }).pipe(Effect.provide(makeMockDeployServiceLayer({}, 1)))
    );

    it.effect("uses custom implementation when configured", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const verified = yield* service.verifyDeployment({
          address: "0x1234567890123456789012345678901234567890" as Address,
          chainId: mainnet.id,
        });

        expect(verified).toBe(false);
      }).pipe(
        Effect.provide(
          makeMockDeployServiceLayer({
            verifyDeployment: () => Effect.succeed(false),
          })
        )
      )
    );
  });

  describe("verifyDeploymentStrict", () => {
    it.effect("accepts expectedBytecode parameter", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const verified = yield* service.verifyDeploymentStrict({
          address: "0x1234567890123456789012345678901234567890" as Address,
          chainId: mainnet.id,
          expectedBytecode: MOCK_BYTECODE,
        });

        expect(verified).toBe(true);
      }).pipe(Effect.provide(makeMockDeployServiceLayer()))
    );

    it.effect("uses custom implementation when configured", () =>
      Effect.gen(function* () {
        const service = yield* DeployService;
        const verified = yield* service.verifyDeploymentStrict({
          address: "0x1234567890123456789012345678901234567890" as Address,
          chainId: mainnet.id,
          expectedBytecode: MOCK_BYTECODE,
        });

        expect(verified).toBe(false);
      }).pipe(
        Effect.provide(
          makeMockDeployServiceLayer({
            verifyDeploymentStrict: () => Effect.succeed(false),
          })
        )
      )
    );
  });
});
