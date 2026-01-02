import { Effect } from "effect";
import type { Address, Hex } from "viem";
import { ERC721_INTERFACE_ID } from "@/src/abi/index.js";
import { ContractReader } from "@/src/contract/index.js";
import type { ClientNotFoundError, ContractReadError } from "@/src/core/index.js";

/** ERC-165 ABI for supportsInterface check */
export const erc165Abi = [
  {
    inputs: [{ name: "interfaceId", type: "bytes4" }],
    name: "supportsInterface",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "view",
    type: "function",
  },
] as const;

/** ERC-165 interface ID for ERC-721 */
export const ERC165_INTERFACE_ID = "0x01ffc9a7" as const;

/**
 * Check if a contract supports ERC-721 via ERC-165 supportsInterface
 */
export const isErc721 = (
  chainId: number,
  address: Address
): Effect.Effect<boolean, ContractReadError | ClientNotFoundError, ContractReader> =>
  Effect.gen(function* () {
    const reader = yield* ContractReader;
    const result = yield* reader.read({
      abi: erc165Abi,
      address,
      args: [ERC721_INTERFACE_ID],
      chainId,
      functionName: "supportsInterface",
    });
    return result as boolean;
  });

/**
 * Check if a contract supports a given interface via ERC-165
 */
export const supportsInterface = (
  chainId: number,
  address: Address,
  interfaceId: Hex
): Effect.Effect<boolean, ContractReadError | ClientNotFoundError, ContractReader> =>
  Effect.gen(function* () {
    const reader = yield* ContractReader;
    const result = yield* reader.read({
      abi: erc165Abi,
      address,
      args: [interfaceId],
      chainId,
      functionName: "supportsInterface",
    });
    return result as boolean;
  });
