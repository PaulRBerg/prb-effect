import { describe, expect, it } from "@effect/vitest";
import type { Address } from "@solana/addresses";
import type { Rpc, SolanaRpcApi } from "@solana/kit";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import {
  decodeBase64ToBuffer,
  makeProgramConnectionShim,
  toAnchorAccounts,
  toAnchorArgs,
  toPublicKey,
  toWeb3AccountInfo,
} from "./anchor-helpers.js";

const TEST_ADDRESS = "DYw8jCTfwHNRJhhmFcbXvVDTqWMEVFBX6ZKUmG5CNSKK" as Address;

describe("toPublicKey", () => {
  it("converts an address to PublicKey", () => {
    const publicKey = toPublicKey(TEST_ADDRESS);

    expect(publicKey).toBeInstanceOf(PublicKey);
    expect(publicKey.toBase58()).toBe(TEST_ADDRESS);
  });
});

describe("toAnchorAccounts", () => {
  it("converts account map values to PublicKeys", () => {
    const result = toAnchorAccounts({
      owner: TEST_ADDRESS,
      stream: TEST_ADDRESS,
    });

    expect(result.owner).toBeInstanceOf(PublicKey);
    expect(result.stream).toBeInstanceOf(PublicKey);
    expect(result.owner.toBase58()).toBe(TEST_ADDRESS);
    expect(result.stream.toBase58()).toBe(TEST_ADDRESS);
  });
});

describe("toAnchorArgs", () => {
  it("converts bigint arguments to BN", () => {
    const [value] = toAnchorArgs([42n]);

    expect(value).toBeInstanceOf(BN);
    expect((value as BN).toString()).toBe("42");
  });

  it("converts integer number arguments to BN", () => {
    const [value] = toAnchorArgs([42]);

    expect(value).toBeInstanceOf(BN);
    expect((value as BN).toString()).toBe("42");
  });

  it("preserves floating-point number arguments", () => {
    const [value] = toAnchorArgs([3.14]);

    expect(value).toBe(3.14);
  });
});

describe("decodeBase64ToBuffer", () => {
  it("decodes base64 payloads to Buffer", () => {
    const decoded = decodeBase64ToBuffer("AQI=");

    expect(decoded).toBeInstanceOf(Buffer);
    expect([...decoded]).toEqual([1, 2]);
  });
});

describe("toWeb3AccountInfo", () => {
  it("maps base64 account info to web3 AccountInfo shape", () => {
    const value = toWeb3AccountInfo({
      data: [Buffer.from([1, 2]).toString("base64"), "base64"],
      executable: false,
      lamports: 42n,
      owner: TEST_ADDRESS,
      rentEpoch: 7n,
    });

    expect(value.data).toBeInstanceOf(Buffer);
    expect([...value.data]).toEqual([1, 2]);
    expect(value.owner.toBase58()).toBe(TEST_ADDRESS);
    expect(value.lamports).toBe(42);
    expect(value.rentEpoch).toBe(7);
  });
});

describe("makeProgramConnectionShim", () => {
  const mockRpc = {
    getAccountInfo: () => ({
      send: async () => ({
        context: { slot: 0n },
        value: {
          data: [Buffer.from([9, 8]).toString("base64"), "base64"] as const,
          executable: false,
          lamports: 99n,
          owner: TEST_ADDRESS,
          rentEpoch: 2n,
        },
      }),
    }),
    getLatestBlockhash: () => ({
      send: async () => ({
        context: { slot: 0n },
        value: {
          blockhash: "blockhash",
          lastValidBlockHeight: 123n,
        },
      }),
    }),
  } as unknown as Rpc<SolanaRpcApi>;

  it("returns web3-compatible account and blockhash values", async () => {
    const connection = makeProgramConnectionShim(mockRpc, "ProgramReader");
    const accountInfo = await (
      connection as unknown as {
        getAccountInfo: (pubkey: PublicKey) => Promise<{
          data: Buffer;
          lamports: number;
          owner: PublicKey;
          rentEpoch: number;
        } | null>;
      }
    ).getAccountInfo(new PublicKey(TEST_ADDRESS));
    const blockhash = await (
      connection as unknown as {
        getLatestBlockhash: () => Promise<{ blockhash: string; lastValidBlockHeight: number }>;
      }
    ).getLatestBlockhash();

    expect(accountInfo).not.toBeNull();
    expect(accountInfo?.owner.toBase58()).toBe(TEST_ADDRESS);
    expect(accountInfo?.lamports).toBe(99);
    expect(accountInfo?.rentEpoch).toBe(2);
    expect(accountInfo?.data).toBeInstanceOf(Buffer);
    const accountData = accountInfo?.data;
    expect(accountData).toBeDefined();
    expect([...(accountData as Buffer)]).toEqual([9, 8]);
    expect(blockhash).toEqual({ blockhash: "blockhash", lastValidBlockHeight: 123 });
  });

  it("throws a descriptive error for unimplemented methods", () => {
    const connection = makeProgramConnectionShim(mockRpc, "ProgramWriter") as unknown as {
      getParsedTransaction: () => void;
    };

    expect(() => connection.getParsedTransaction()).toThrow(
      'ProgramWriter connection shim does not implement "getParsedTransaction"'
    );
  });
});
