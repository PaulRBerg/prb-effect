import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Address } from "viem";
import { mainnet } from "viem/chains";
import { Erc721Service } from "#src/erc721/index.js";
import { makeMockErc721ServiceLayer } from "#src/testing-kit/index.js";

describe("testing-kit: makeMockErc721ServiceLayer", () => {
  const testLayer = makeMockErc721ServiceLayer();
  const testContract = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
  const testOwner = "0x1234567890123456789012345678901234567890" as Address;

  describe("ownerOf", () => {
    it.effect("returns owner address", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const owner = yield* service.ownerOf({
          address: testContract,
          chainId: mainnet.id,
          tokenId: 1n,
        });

        expect(owner).toBe("0x1234567890123456789012345678901234567890");
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("can be configured with custom owner", () => {
      const customOwner = "0x9999999999999999999999999999999999999999" as Address;
      const customLayer = makeMockErc721ServiceLayer({
        ownerOf: () => Effect.succeed(customOwner),
      });

      return Effect.gen(function* () {
        const service = yield* Erc721Service;
        const owner = yield* service.ownerOf({
          address: testContract,
          chainId: mainnet.id,
          tokenId: 1n,
        });

        expect(owner).toBe(customOwner);
      }).pipe(Effect.provide(customLayer));
    });
  });

  describe("balanceOf", () => {
    it.effect("returns balance", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const balance = yield* service.balanceOf({
          address: testContract,
          chainId: mainnet.id,
          owner: testOwner,
        });

        expect(balance).toBe(5n);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("can be configured with custom balance", () => {
      const customLayer = makeMockErc721ServiceLayer({
        balanceOf: () => Effect.succeed(42n),
      });

      return Effect.gen(function* () {
        const service = yield* Erc721Service;
        const balance = yield* service.balanceOf({
          address: testContract,
          chainId: mainnet.id,
          owner: testOwner,
        });

        expect(balance).toBe(42n);
      }).pipe(Effect.provide(customLayer));
    });
  });

  describe("getApproved", () => {
    it.effect("returns approved address", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const approved = yield* service.getApproved({
          address: testContract,
          chainId: mainnet.id,
          tokenId: 1n,
        });

        expect(approved).toBe("0x1234567890123456789012345678901234567890");
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("can be configured with custom approved address", () => {
      const customApproved = "0x8888888888888888888888888888888888888888" as Address;
      const customLayer = makeMockErc721ServiceLayer({
        getApproved: () => Effect.succeed(customApproved),
      });

      return Effect.gen(function* () {
        const service = yield* Erc721Service;
        const approved = yield* service.getApproved({
          address: testContract,
          chainId: mainnet.id,
          tokenId: 1n,
        });

        expect(approved).toBe(customApproved);
      }).pipe(Effect.provide(customLayer));
    });
  });

  describe("isApprovedForAll", () => {
    it.effect("returns boolean", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const isApproved = yield* service.isApprovedForAll({
          address: testContract,
          chainId: mainnet.id,
          operator: "0x7777777777777777777777777777777777777777" as Address,
          owner: testOwner,
        });

        expect(typeof isApproved).toBe("boolean");
        expect(isApproved).toBe(false);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("can be configured to return true", () => {
      const customLayer = makeMockErc721ServiceLayer({
        isApprovedForAll: () => Effect.succeed(true),
      });

      return Effect.gen(function* () {
        const service = yield* Erc721Service;
        const isApproved = yield* service.isApprovedForAll({
          address: testContract,
          chainId: mainnet.id,
          operator: "0x7777777777777777777777777777777777777777" as Address,
          owner: testOwner,
        });

        expect(isApproved).toBe(true);
      }).pipe(Effect.provide(customLayer));
    });
  });

  describe("tokenURI", () => {
    it.effect("returns URI", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const uri = yield* service.tokenURI({
          address: testContract,
          chainId: mainnet.id,
          tokenId: 1n,
        });

        expect(uri).toBe("ipfs://QmMockHash/metadata.json");
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("can be configured with custom URI", () => {
      const customLayer = makeMockErc721ServiceLayer({
        tokenURI: () => Effect.succeed("https://example.com/token/1"),
      });

      return Effect.gen(function* () {
        const service = yield* Erc721Service;
        const uri = yield* service.tokenURI({
          address: testContract,
          chainId: mainnet.id,
          tokenId: 1n,
        });

        expect(uri).toBe("https://example.com/token/1");
      }).pipe(Effect.provide(customLayer));
    });
  });

  describe("fetchMetadata", () => {
    it.effect("returns NftMetadata object", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const metadata = yield* service.fetchMetadata({
          address: testContract,
          chainId: mainnet.id,
          tokenId: 1n,
        });

        expect(metadata).toEqual({
          attributes: [],
          description: "A mock NFT for testing purposes",
          image: "ipfs://QmMockHash/image.png",
          name: "Mock NFT",
        });
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("can be configured with custom metadata", () => {
      const customLayer = makeMockErc721ServiceLayer({
        fetchMetadata: () =>
          Effect.succeed({
            description: "Custom NFT",
            image: "https://example.com/image.png",
            name: "Custom Token",
            attributes: [
              { trait_type: "Rarity", value: "Legendary" },
              { trait_type: "Level", value: 99 },
            ],
          }),
      });

      return Effect.gen(function* () {
        const service = yield* Erc721Service;
        const metadata = yield* service.fetchMetadata({
          address: testContract,
          chainId: mainnet.id,
          tokenId: 1n,
        });

        expect(metadata.name).toBe("Custom Token");
        expect(metadata.attributes).toHaveLength(2);
      }).pipe(Effect.provide(customLayer));
    });

    it.effect("accepts optional gateways parameter", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const metadata = yield* service.fetchMetadata({
          address: testContract,
          chainId: mainnet.id,
          tokenId: 1n,
          gateways: {
            arweave: "https://arweave.net",
            ipfs: "https://ipfs.io",
          },
        });

        expect(metadata.name).toBe("Mock NFT");
      }).pipe(Effect.provide(testLayer))
    );
  });

  describe("name", () => {
    it.effect("returns collection name", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const name = yield* service.name({
          address: testContract,
          chainId: mainnet.id,
        });

        expect(name).toBe("MockNFT");
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("can be configured with custom name", () => {
      const customLayer = makeMockErc721ServiceLayer({
        name: () => Effect.succeed("Cool Collection"),
      });

      return Effect.gen(function* () {
        const service = yield* Erc721Service;
        const name = yield* service.name({
          address: testContract,
          chainId: mainnet.id,
        });

        expect(name).toBe("Cool Collection");
      }).pipe(Effect.provide(customLayer));
    });
  });

  describe("symbol", () => {
    it.effect("returns symbol", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const symbol = yield* service.symbol({
          address: testContract,
          chainId: mainnet.id,
        });

        expect(symbol).toBe("MNFT");
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("can be configured with custom symbol", () => {
      const customLayer = makeMockErc721ServiceLayer({
        symbol: () => Effect.succeed("COOL"),
      });

      return Effect.gen(function* () {
        const service = yield* Erc721Service;
        const symbol = yield* service.symbol({
          address: testContract,
          chainId: mainnet.id,
        });

        expect(symbol).toBe("COOL");
      }).pipe(Effect.provide(customLayer));
    });
  });

  describe("totalSupply", () => {
    it.effect("returns supply", () =>
      Effect.gen(function* () {
        const service = yield* Erc721Service;
        const supply = yield* service.totalSupply({
          address: testContract,
          chainId: mainnet.id,
        });

        expect(supply).toBe(10000n);
      }).pipe(Effect.provide(testLayer))
    );

    it.effect("can be configured with custom supply", () => {
      const customLayer = makeMockErc721ServiceLayer({
        totalSupply: () => Effect.succeed(5555n),
      });

      return Effect.gen(function* () {
        const service = yield* Erc721Service;
        const supply = yield* service.totalSupply({
          address: testContract,
          chainId: mainnet.id,
        });

        expect(supply).toBe(5555n);
      }).pipe(Effect.provide(customLayer));
    });
  });
});
