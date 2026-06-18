import { describe, expect, it } from "@effect/vitest";
import { PublicKey } from "@solana/web3.js";
import BN from "bn.js";
import { makeMockRpc } from "#src/testing-kit/index.js";
import type { Address } from "#src/types/index.js";
import {
  fromAnchorValue,
  makeProgramConnectionShim,
  toAnchorAccounts,
  toAnchorArgs,
  toPublicKey,
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

describe("fromAnchorValue", () => {
  it("converts BN scalars to bigint", () => {
    expect(fromAnchorValue(new BN(42))).toBe(42n);
    expect(fromAnchorValue(new BN(-42))).toBe(-42n);
  });

  it("converts BN-like values from another package instance", () => {
    const value = {
      constructor: { wordSize: BN.wordSize },
      words: [42],
      toString: () => "42",
    };

    expect(fromAnchorValue(value)).toBe(42n);
  });

  it("recurses through arrays and plain objects", () => {
    const result = fromAnchorValue({
      amount: new BN(42),
      nested: {
        fees: [new BN(1), new BN(2)],
      },
    }) as {
      readonly amount: unknown;
      readonly nested: { readonly fees: readonly unknown[] };
    };

    expect(result.amount).toBe(42n);
    expect(result.nested.fees).toEqual([1n, 2n]);
  });

  it("leaves PublicKey values untouched", () => {
    const recipient = new PublicKey(TEST_ADDRESS);
    const result = fromAnchorValue({
      amount: new BN(42),
      recipient,
    }) as {
      readonly amount: unknown;
      readonly recipient: unknown;
    };

    expect(result.amount).toBe(42n);
    expect(result.recipient).toBe(recipient);
    expect(result.recipient).toBeInstanceOf(PublicKey);
    expect((result.recipient as PublicKey).toBase58()).toBe(TEST_ADDRESS);
  });

  it("leaves byte buffers and non-plain objects untouched", () => {
    const buffer = Buffer.from([1, 2]);
    const bytes = new Uint8Array([3, 4]);
    const date = new Date("2026-06-18T00:00:00.000Z");

    expect(fromAnchorValue(buffer)).toBe(buffer);
    expect(fromAnchorValue(bytes)).toBe(bytes);
    expect(fromAnchorValue(date)).toBe(date);
  });

  it("leaves primitives untouched", () => {
    expect(fromAnchorValue(42)).toBe(42);
    expect(fromAnchorValue(3.14)).toBe(3.14);
    expect(fromAnchorValue("value")).toBe("value");
    expect(fromAnchorValue(true)).toBe(true);
    expect(fromAnchorValue(null)).toBeNull();
    expect(fromAnchorValue(undefined)).toBeUndefined();
  });
});

describe("makeProgramConnectionShim", () => {
  const mockRpc = makeMockRpc({
    getAccountInfo: () =>
      Promise.resolve({
        data: Buffer.from([9, 8]),
        executable: false,
        lamports: 99,
        owner: new PublicKey(TEST_ADDRESS),
        rentEpoch: 2,
      }),
    getLatestBlockhash: () =>
      Promise.resolve({
        blockhash: "blockhash",
        lastValidBlockHeight: 123,
      }),
  });

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
