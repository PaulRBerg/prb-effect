import type { Abi } from "viem";

/**
 * Minimal ERC-20 ABI variant where `approve` has no return value.
 *
 * Some tokens (notably USDT on mainnet) do not return a boolean from `approve`,
 * which makes standard ERC-20 ABIs fail when decoding the response.
 */
export const erc20NoOutputAbi = [
  {
    name: "approve",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
    inputs: [
      { name: "spender", type: "address" },
      { name: "value", type: "uint256" },
    ],
  },
] as const satisfies Abi;
