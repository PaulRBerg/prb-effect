import { describe, expect, it } from "@effect/vitest";
import { Cause, Effect, Exit } from "effect";
import type { Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { mainnet } from "viem/chains";
import {
  InvalidSignatureError,
  SignatureService,
  SignatureServiceLive,
} from "#src/signature/index.js";

describe("SignatureService", () => {
  const testLayer = SignatureServiceLive;
  const account = privateKeyToAccount(
    "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef" as Hex
  );

  describe("hashMessage", () => {
    it.effect("returns hash for string message", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const result = yield* service.hashMessage("Hello, world!");

        expect(result).toBeDefined();
        expect(result.startsWith("0x")).toBe(true);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns hash for Uint8Array message", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const message = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        const result = yield* service.hashMessage(message);

        expect(result).toBeDefined();
        expect(result.startsWith("0x")).toBe(true);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("hashTypedData", () => {
    it.effect("returns hash for typed data", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const result = yield* service.hashTypedData({
          primaryType: "Test",
          domain: {
            chainId: mainnet.id,
            name: "Test",
          },
          message: {
            test: "value",
          },
          types: {
            Test: [{ name: "test", type: "string" }],
          },
        });

        expect(result).toBeDefined();
        expect(result.startsWith("0x")).toBe(true);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("splitSignature", () => {
    it.effect("splits valid signature into r, s, v components", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const signature =
          "0x1234567890123456789012345678901234567890123456789012345678901234abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd1b" as Hex;

        const result = yield* service.splitSignature(signature);

        expect(result.r).toBeDefined();
        expect(result.s).toBeDefined();
        expect(result.v).toBeDefined();
        expect(result.r.startsWith("0x")).toBe(true);
        expect(result.s.startsWith("0x")).toBe(true);
        expect(typeof result.v).toBe("bigint");
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("fails with InvalidSignatureError for invalid signature", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const exit = yield* Effect.exit(service.splitSignature("0xinvalid" as Hex));

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const error = Cause.findErrorOption(exit.cause);
          if (error._tag === "Some") {
            expect(error.value).toBeInstanceOf(InvalidSignatureError);
          }
        }
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("joinSignature", () => {
    it.effect("joins r, s, v into signature", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const result = yield* service.joinSignature({
          r: "0x1234567890123456789012345678901234567890123456789012345678901234" as Hex,
          s: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Hex,
          v: 27n,
        });

        expect(result).toBeDefined();
        expect(result.startsWith("0x")).toBe(true);
        expect(result.length).toBe(132); // 0x + 130 hex chars
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("verifyMessage", () => {
    it.effect("returns true for valid signature", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const message = "Hello, world!";
        const signature = yield* Effect.promise(() =>
          account.signMessage({
            message,
          })
        );
        const result = yield* service.verifyMessage({
          address: account.address,
          message,
          signature,
        });

        expect(result).toBe(true);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("returns false for invalid signature", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const result = yield* service.verifyMessage({
          address: account.address,
          message: "Hello, world!",
          signature:
            "0x0000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000" as Hex,
        });

        expect(result).toBe(false);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("verifyTypedData", () => {
    it.effect("returns true for valid typed data signature", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const domain = {
          chainId: mainnet.id,
          name: "Test",
        } as const;
        const types = {
          Test: [{ name: "test", type: "string" }],
        } as const;
        const message = {
          test: "value",
        } as const;

        const signature = yield* Effect.promise(() =>
          account.signTypedData({
            domain,
            message,
            primaryType: "Test",
            types,
          })
        );
        const result = yield* service.verifyTypedData({
          address: account.address,
          domain,
          message,
          primaryType: "Test",
          signature,
          types,
        });

        expect(result).toBe(true);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("recoverAddress", () => {
    it.effect("recovers address from message signature", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const message = "Hello, world!";
        const signature = yield* Effect.promise(() =>
          account.signMessage({
            message,
          })
        );
        const result = yield* service.recoverAddress({
          message,
          signature,
        });

        expect(result).toBe(account.address);
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("recoverTypedDataAddress", () => {
    it.effect("recovers address from typed data signature", () =>
      Effect.gen(function* () {
        const service = yield* SignatureService;
        const domain = {
          chainId: mainnet.id,
          name: "Test",
        } as const;
        const types = {
          Test: [{ name: "test", type: "string" }],
        } as const;
        const message = {
          test: "value",
        } as const;

        const signature = yield* Effect.promise(() =>
          account.signTypedData({
            domain,
            message,
            primaryType: "Test",
            types,
          })
        );
        const result = yield* service.recoverTypedDataAddress({
          domain,
          message,
          primaryType: "Test",
          signature,
          types,
        });

        expect(result).toBe(account.address);
      }).pipe(Effect.provide(testLayer))
    );
  });
});
