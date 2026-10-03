import { describe, expect, it } from "@effect/vitest";
import type { Hex } from "viem";
import { stringToHex } from "viem";
import { decodeBytes32String } from "./utils.js";

describe("decodeBytes32String", () => {
  it.each(["Token", "Café", "猫", "🪙"])("decodes UTF-8 metadata %s", (value) => {
    expect(decodeBytes32String(stringToHex(value, { size: 32 }))).toBe(value);
  });

  it.each([
    "0x",
    "0x00",
    "0xff",
    "0xc3",
    "0x4g41",
    "0x414",
    "0x2020",
  ] as Hex[])("rejects empty or malformed metadata %s", (value) => {
    expect(decodeBytes32String(value)).toBeUndefined();
  });
});
