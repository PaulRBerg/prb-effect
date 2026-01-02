import type { Abi, Address, Hex } from "viem";
import { encodeAbiParameters, encodeFunctionData } from "viem";

export type Erc7579CallType = "single" | "batch";
export type Erc7579ExecType = "default" | "try";

export type Erc7579ModeCode = Hex;

export type Erc7579Execution = {
  readonly target: Address;
  readonly value: bigint;
  readonly callData: Hex;
};

const erc7579ExecutionTuple = {
  components: [
    { name: "target", type: "address" },
    { name: "value", type: "uint256" },
    { name: "callData", type: "bytes" },
  ],
  name: "executions",
  type: "tuple[]",
} as const;

export const erc7579AccountAbi = [
  {
    inputs: [
      { name: "mode", type: "bytes32" },
      { name: "executionCalldata", type: "bytes" },
    ],
    name: "execute",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const satisfies Abi;

export function encodeErc7579BatchExecutionCalldata(executions: readonly Erc7579Execution[]): Hex {
  return encodeAbiParameters([erc7579ExecutionTuple], [executions]);
}

export function encodeErc7579ExecuteCalldata(params: {
  readonly mode: Erc7579ModeCode;
  readonly executionCalldata: Hex;
}): Hex {
  return encodeFunctionData({
    abi: erc7579AccountAbi,
    args: [params.mode, params.executionCalldata],
    functionName: "execute",
  });
}

export function encodeErc7579SimpleMode(params: {
  readonly callType: Erc7579CallType;
  readonly execType?: Erc7579ExecType | undefined;
}): Erc7579ModeCode {
  const callTypeByte = params.callType === "batch" ? 0x01 : 0x00;
  const execTypeByte = (params.execType ?? "default") === "try" ? 0x01 : 0x00;
  return `0x${callTypeByte.toString(16).padStart(2, "0")}${execTypeByte.toString(16).padStart(2, "0")}${"00".repeat(
    30
  )}` as const;
}

export const ERC7579_MODE_SIMPLE_SINGLE = encodeErc7579SimpleMode({
  callType: "single",
});

export const ERC7579_MODE_SIMPLE_BATCH = encodeErc7579SimpleMode({
  callType: "batch",
});

export const ERC7579_MODE_SIMPLE_SINGLE_TRY = encodeErc7579SimpleMode({
  callType: "single",
  execType: "try",
});

export const ERC7579_MODE_SIMPLE_BATCH_TRY = encodeErc7579SimpleMode({
  callType: "batch",
  execType: "try",
});
