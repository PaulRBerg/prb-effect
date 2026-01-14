import { Effect } from "effect";
import type { Address, Hex } from "viem";
import { erc20Abi, erc20Abi_bytes32 } from "@/src/abi/index.js";
import { decodeBytes32String } from "@/src/balance/index.js";
import { ContractReader } from "@/src/contract/index.js";
import type { ClientNotFoundError, MulticallError } from "@/src/core/index.js";
import type { MulticallResult } from "@/src/types/index.js";

export type Erc20Metadata = {
  address: Address;
  chainId: number;
  decimals: number;
  name?: string;
  symbol?: string;
};

/**
 * Read ERC-20 token metadata (decimals, name, symbol) with bytes32 fallbacks.
 */
export function readErc20Metadata(params: {
  chainId: number;
  tokenAddress: Address;
}): Effect.Effect<Erc20Metadata, MulticallError | ClientNotFoundError, ContractReader> {
  return Effect.gen(function* () {
    const reader = yield* ContractReader;
    const results = yield* reader.multicall(params.chainId, [
      {
        abi: erc20Abi,
        address: params.tokenAddress,
        functionName: "decimals",
      },
      {
        abi: erc20Abi,
        address: params.tokenAddress,
        functionName: "name",
      },
      {
        abi: erc20Abi,
        address: params.tokenAddress,
        functionName: "symbol",
      },
      {
        abi: erc20Abi_bytes32,
        address: params.tokenAddress,
        functionName: "name",
      },
      {
        abi: erc20Abi_bytes32,
        address: params.tokenAddress,
        functionName: "symbol",
      },
    ] as const);

    const [decimalsResult, nameResult, symbolResult, nameBytes32Result, symbolBytes32Result] =
      results;

    const decimals = (() => {
      if (decimalsResult.status !== "success") {
        return 18;
      }

      const value =
        typeof decimalsResult.result === "bigint"
          ? Number(decimalsResult.result)
          : decimalsResult.result;

      return Number.isSafeInteger(value) && value >= 0 && value <= 255 ? value : 18;
    })();

    const name = extractStringOrBytes32(
      nameResult as MulticallResult<string>,
      nameBytes32Result as MulticallResult<Hex>
    );
    const symbol = extractStringOrBytes32(
      symbolResult as MulticallResult<string>,
      symbolBytes32Result as MulticallResult<Hex>
    );

    return {
      address: params.tokenAddress,
      chainId: params.chainId,
      decimals,
      name,
      symbol,
    };
  });
}

function extractStringOrBytes32(
  stringResult: MulticallResult<string>,
  bytes32Result: MulticallResult<Hex>
): string | undefined {
  const normalized =
    stringResult.status === "success" ? normalizeString(stringResult.result) : undefined;
  if (normalized) {
    return normalized;
  }

  return bytes32Result.status === "success" ? decodeBytes32String(bytes32Result.result) : undefined;
}

function normalizeString(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}
