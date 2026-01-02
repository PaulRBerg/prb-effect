/**
 * Safe multisig ABIs for gas simulation and multi-send operations.
 *
 * @see https://github.com/safe-global/safe-deployments
 */

const multisigAbi = [
  {
    inputs: [],
    name: "getOwners",
    outputs: [
      {
        name: "",
        type: "address[]",
      },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [
      { internalType: "address", name: "targetContract", type: "address" },
      { internalType: "bytes", name: "calldataPayload", type: "bytes" },
    ],
    name: "simulateAndRevert",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

const multiSendAbi = [
  {
    inputs: [{ internalType: "bytes", name: "transactions", type: "bytes" }],
    name: "multiSend",
    outputs: [],
    stateMutability: "payable",
    type: "function",
  },
] as const;

const simulateAccessorAbi = [
  {
    inputs: [
      { internalType: "address", name: "to", type: "address" },
      { internalType: "uint256", name: "value", type: "uint256" },
      { internalType: "bytes", name: "data", type: "bytes" },
      {
        internalType: "enum Enum.Operation",
        name: "operation",
        type: "uint8",
      },
    ],
    name: "simulate",
    outputs: [
      { internalType: "uint256", name: "estimate", type: "uint256" },
      { internalType: "bool", name: "success", type: "bool" },
      { internalType: "bytes", name: "returnData", type: "bytes" },
    ],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

export const safeAbis = {
  multiSend: multiSendAbi,
  multisig: multisigAbi,
  simulateAccessor: simulateAccessorAbi,
} as const;
