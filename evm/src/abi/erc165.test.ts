import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import {
  ERC165_INTERFACE_ID,
  ERC721_INTERFACE_ID,
  erc165Abi,
  isErc721,
  supportsInterface,
} from "@/src/abi/index.js";
import { ContractReaderLive } from "@/src/contract/index.js";
import {
  makeMockPublicClientLayer,
  TEST_ADDRESS,
  TEST_CHAIN_ID,
  UNKNOWN_CHAIN_ID,
} from "@/src/testing-kit/index.js";

describe("ERC-165 ABI", () => {
  it("exports erc165Abi with supportsInterface function", () => {
    expect(erc165Abi).toBeDefined();
    expect(Array.isArray(erc165Abi)).toBe(true);

    const supportsInterfaceFn = erc165Abi.find(
      (item) => item.type === "function" && item.name === "supportsInterface"
    );
    expect(supportsInterfaceFn).toBeDefined();
    expect(supportsInterfaceFn?.inputs).toHaveLength(1);
    expect(supportsInterfaceFn?.inputs[0].type).toBe("bytes4");
    expect(supportsInterfaceFn?.outputs).toHaveLength(1);
    expect(supportsInterfaceFn?.outputs[0].type).toBe("bool");
  });

  it("exports correct ERC-165 interface ID", () => {
    expect(ERC165_INTERFACE_ID).toBe("0x01ffc9a7");
  });
});

describe("isErc721", () => {
  it.effect("returns true when contract supports ERC-721 interface", () =>
    Effect.gen(function* () {
      const result = yield* isErc721(TEST_CHAIN_ID, TEST_ADDRESS);
      expect(result).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.provide(
          ContractReaderLive,
          makeMockPublicClientLayer({
            readContract: (params: unknown) => {
              const p = params as { args: [string] };
              // Return true for ERC-721 interface ID
              return Promise.resolve(p.args[0] === ERC721_INTERFACE_ID);
            },
          })
        )
      )
    )
  );

  it.effect("returns false when contract does not support ERC-721 interface", () =>
    Effect.gen(function* () {
      const result = yield* isErc721(TEST_CHAIN_ID, TEST_ADDRESS);
      expect(result).toBe(false);
    }).pipe(
      Effect.provide(
        Layer.provide(
          ContractReaderLive,
          makeMockPublicClientLayer({
            readContract: () => Promise.resolve(false),
          })
        )
      )
    )
  );

  it.effect("fails with ContractReadError when contract call fails", () =>
    Effect.gen(function* () {
      const exit = yield* isErc721(TEST_CHAIN_ID, TEST_ADDRESS).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.provide(
          ContractReaderLive,
          makeMockPublicClientLayer({
            readContract: () => Promise.reject(new Error("Contract does not implement ERC-165")),
          })
        )
      )
    )
  );

  it.effect("fails with ClientNotFoundError for unknown chainId", () =>
    Effect.gen(function* () {
      const exit = yield* isErc721(UNKNOWN_CHAIN_ID, TEST_ADDRESS).pipe(Effect.exit);
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(Effect.provide(Layer.provide(ContractReaderLive, makeMockPublicClientLayer())))
  );
});

describe("supportsInterface", () => {
  it.effect("returns true when contract supports given interface", () =>
    Effect.gen(function* () {
      const result = yield* supportsInterface(TEST_CHAIN_ID, TEST_ADDRESS, ERC165_INTERFACE_ID);
      expect(result).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.provide(
          ContractReaderLive,
          makeMockPublicClientLayer({
            readContract: (params: unknown) => {
              const p = params as { args: [string] };
              return Promise.resolve(p.args[0] === ERC165_INTERFACE_ID);
            },
          })
        )
      )
    )
  );

  it.effect("returns false when contract does not support given interface", () =>
    Effect.gen(function* () {
      const result = yield* supportsInterface(TEST_CHAIN_ID, TEST_ADDRESS, "0x12345678");
      expect(result).toBe(false);
    }).pipe(
      Effect.provide(
        Layer.provide(
          ContractReaderLive,
          makeMockPublicClientLayer({
            readContract: () => Promise.resolve(false),
          })
        )
      )
    )
  );

  it.effect("can check for ERC-721 interface via generic supportsInterface", () =>
    Effect.gen(function* () {
      const result = yield* supportsInterface(TEST_CHAIN_ID, TEST_ADDRESS, ERC721_INTERFACE_ID);
      expect(result).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.provide(
          ContractReaderLive,
          makeMockPublicClientLayer({
            readContract: (params: unknown) => {
              const p = params as { args: [string] };
              return Promise.resolve(p.args[0] === ERC721_INTERFACE_ID);
            },
          })
        )
      )
    )
  );

  it.effect("fails with ContractReadError when contract call fails", () =>
    Effect.gen(function* () {
      const exit = yield* supportsInterface(TEST_CHAIN_ID, TEST_ADDRESS, ERC165_INTERFACE_ID).pipe(
        Effect.exit
      );
      expect(Exit.isFailure(exit)).toBe(true);
    }).pipe(
      Effect.provide(
        Layer.provide(
          ContractReaderLive,
          makeMockPublicClientLayer({
            readContract: () => Promise.reject(new Error("RPC error")),
          })
        )
      )
    )
  );
});
