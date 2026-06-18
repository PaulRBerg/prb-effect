/**
 * Shared helpers for Anchor program interaction.
 *
 * Used by both ProgramWriter and ProgramReader to adapt Anchor inputs.
 *
 * @internal
 */

import type { Program } from "@coral-xyz/anchor";
import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import type { Address } from "#src/types/index.js";
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

export function makeProgramConnectionShim(
  connection: Connection,
  serviceName: "ProgramReader" | "ProgramWriter"
): Program["provider"]["connection"] {
  const knownConnectionMethods = {
    getAccountInfo: (pubkey: PublicKey) => connection.getAccountInfo(pubkey),
    getLatestBlockhash: async () => {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      return { blockhash, lastValidBlockHeight };
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
