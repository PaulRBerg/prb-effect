/**
 * Shared helpers for Anchor program interaction.
 *
 * Used by both ProgramWriter and ProgramReader to convert between
 * Solana kit types and Anchor's legacy @solana/web3.js types.
 *
 * @internal
 */

import type { Program } from "@coral-xyz/anchor";
import type { Address } from "@solana/addresses";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import type { AccountInfo } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { Buffer } from "buffer";
import type { AccountsMap } from "../types.js";

/**
 * Convert a string/Address to PublicKey.
 */
export function toPublicKey(address: Address | string): PublicKey {
  return new PublicKey(address);
}

/**
 * Convert account map values to PublicKeys for Anchor.
 */
export function toAnchorAccounts(accounts: AccountsMap): Record<string, PublicKey> {
  const result: Record<string, PublicKey> = {};
  for (const [key, value] of Object.entries(accounts)) {
    result[key] = toPublicKey(value);
  }
  return result;
}

/**
 * Convert args to Anchor-compatible format.
 * Handles bigint and integer number -> BN conversion for borsh integer layouts.
 */
export function toAnchorArgs(args: readonly unknown[]): unknown[] {
  return args.map((arg) => {
    if (typeof arg === "bigint") {
      return new BN(arg.toString());
    }
    if (typeof arg === "number" && Number.isInteger(arg)) {
      return new BN(arg.toString());
    }
    return arg;
  });
}

export type Base64AccountInfoLike = Readonly<{
  data: readonly [string, string];
  executable: boolean;
  lamports: bigint | number;
  owner: Address;
  rentEpoch?: bigint | number;
}>;

export function decodeBase64ToBuffer(encoded: string): Buffer {
  return Buffer.from(encoded, "base64");
}

export function toWeb3AccountInfo(value: Base64AccountInfoLike): AccountInfo<Buffer> {
  const [encodedData] = value.data;

  return {
    data: decodeBase64ToBuffer(encodedData),
    executable: value.executable,
    // web3.js AccountInfo requires number lamports. Values above Number.MAX_SAFE_INTEGER
    // can lose precision during conversion, but this boundary is required for compatibility.
    lamports: Number(value.lamports),
    owner: toPublicKey(value.owner),
    rentEpoch: Number(value.rentEpoch ?? 0),
  };
}

export function makeProgramConnectionShim(
  rpc: Rpc<SolanaRpcApi>,
  serviceName: "ProgramReader" | "ProgramWriter"
): Program["provider"]["connection"] {
  const knownConnectionMethods = {
    getAccountInfo: async (pubkey: PublicKey) => {
      const response = await rpc
        .getAccountInfo(pubkey.toBase58() as Address, { encoding: "base64" })
        .send();
      return response.value === null
        ? null
        : toWeb3AccountInfo(response.value as Base64AccountInfoLike);
    },
    getLatestBlockhash: async () => {
      const { blockhash, lastValidBlockHeight } = (await rpc.getLatestBlockhash().send()).value;
      return { blockhash, lastValidBlockHeight: Number(lastValidBlockHeight) };
    },
  };

  return new Proxy(knownConnectionMethods, {
    get: (target, property, receiver) => {
      if (typeof property === "string" && !(property in target)) {
        return (..._args: unknown[]) => {
          throw new Error(
            `${serviceName} connection shim does not implement "${property}". Update ${serviceName}Live for the current Anchor requirements.`
          );
        };
      }

      return Reflect.get(target, property, receiver);
    },
  }) as unknown as Program["provider"]["connection"];
}
