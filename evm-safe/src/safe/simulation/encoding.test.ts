import { describe, expect, it } from "@effect/vitest";
import type { Address, Hex } from "viem";
import { encodeInternalTx, encodeMultiSend } from "./encoding.js";
import type { SafeMultisigSimulationTx } from "./types.js";

const TO = "0x0000000000000000000000000000000000000001" as Address;

function makeTx(data: string): { data: Hex; operation: 0; to: Address; value: bigint } {
  return { data: data as Hex, operation: 0, to: TO, value: 0n };
}

const HEX_BODY = /^[0-9a-f]+$/;

describe("encodeInternalTx", () => {
  it("encodes an empty-calldata transaction", () => {
    const encoded = encodeInternalTx(makeTx("0x"));
    expect(HEX_BODY.test(encoded)).toBe(true);
    // data length word must be 0 for empty calldata
    expect(encoded.slice(-64)).toBe("0".repeat(64));
  });

  it("encodes a well-formed even-length calldata transaction", () => {
    const encoded = encodeInternalTx(makeTx("0xabcd"));
    expect(HEX_BODY.test(encoded)).toBe(true);
    expect(encoded.endsWith("abcd")).toBe(true);
  });

  it("throws on odd-length hex calldata (would silently truncate the byte length)", () => {
    expect(() => encodeInternalTx(makeTx("0xabc"))).toThrowError("Invalid transaction data");
  });

  it("throws on non-hex calldata", () => {
    expect(() => encodeInternalTx(makeTx("not-hex"))).toThrowError("Invalid transaction data");
  });

  it("propagates the validation error through encodeMultiSend", () => {
    const txs: SafeMultisigSimulationTx[] = [
      { data: "0xabc" as Hex, operation: 0, to: TO, value: 0n },
    ];
    expect(() => encodeMultiSend(txs)).toThrowError("Invalid transaction data");
  });
});
