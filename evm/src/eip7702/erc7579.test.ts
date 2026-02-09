import { describe, expect, it } from "@effect/vitest";
import { decodeAbiParameters, decodeFunctionData, getAddress } from "viem";
import {
  ERC7579_MODE_SIMPLE_BATCH,
  ERC7579_MODE_SIMPLE_BATCH_TRY,
  ERC7579_MODE_SIMPLE_SINGLE,
  encodeErc7579BatchExecutionCalldata,
  encodeErc7579ExecuteCalldata,
  encodeErc7579SimpleMode,
  erc7579AccountAbi,
} from "#src/eip7702/index.js";

describe("EIP-7702 / ERC-7579 helpers", () => {
  describe("encodeErc7579SimpleMode", () => {
    it("encodes simple single as 0x00..00", () => {
      expect(ERC7579_MODE_SIMPLE_SINGLE).toBe(`0x${"00".repeat(32)}`);
    });

    it("encodes simple batch as 0x0100..00", () => {
      expect(ERC7579_MODE_SIMPLE_BATCH).toBe(`0x0100${"00".repeat(30)}`);
    });

    it("encodes simple batch try as 0x0101..00", () => {
      expect(ERC7579_MODE_SIMPLE_BATCH_TRY).toBe(`0x0101${"00".repeat(30)}`);
    });

    it("roundtrips callType/execType bytes", () => {
      const mode = encodeErc7579SimpleMode({
        callType: "batch",
        execType: "try",
      });
      expect(mode.slice(0, 6)).toBe("0x0101");
      expect(mode).toBe(ERC7579_MODE_SIMPLE_BATCH_TRY);
    });
  });

  describe("encodeErc7579BatchExecutionCalldata", () => {
    it("encodes ABI-decodable Execution[]", () => {
      const executions = [
        {
          callData: "0x1234",
          target: "0x1234567890123456789012345678901234567890",
          value: 0n,
        },
        {
          callData: "0x",
          target: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
          value: 1n,
        },
      ] as const;

      const calldata = encodeErc7579BatchExecutionCalldata(executions);
      const [decoded] = decodeAbiParameters(
        [
          {
            components: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "callData", type: "bytes" },
            ],
            name: "executions",
            type: "tuple[]",
          },
        ],
        calldata
      );

      expect(decoded).toEqual(
        executions.map((execution) => ({
          ...execution,
          target: getAddress(execution.target),
        }))
      );
    });
  });

  describe("encodeErc7579ExecuteCalldata", () => {
    it("encodes execute(mode, bytes) for ERC-7579 accounts", () => {
      const executionCalldata = encodeErc7579BatchExecutionCalldata([
        {
          callData: "0x",
          target: "0x1234567890123456789012345678901234567890",
          value: 0n,
        },
      ]);

      const data = encodeErc7579ExecuteCalldata({
        executionCalldata,
        mode: ERC7579_MODE_SIMPLE_BATCH,
      });

      const decoded = decodeFunctionData({ abi: erc7579AccountAbi, data });
      expect(decoded.functionName).toBe("execute");
      expect(decoded.args[0]).toBe(ERC7579_MODE_SIMPLE_BATCH);
      expect(decoded.args[1]).toBe(executionCalldata);
    });
  });
});
