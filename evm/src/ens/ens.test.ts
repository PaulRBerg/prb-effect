import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit, Layer } from "effect";
import type { Address } from "viem";
import { EnsResolver, EnsResolverLive } from "#src/ens/index.js";
import { makeMockPublicClientLayer, TEST_ADDRESS } from "#src/testing-kit/index.js";

const TEST_ENS_NAME = "vitalik.eth";
const TEST_ENS_AVATAR = "https://ipfs.io/ipfs/QmTest123";
const TEST_ENS_TEXT = "test_twitter_handle";
const TEST_RESOLVER_ADDRESS = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41" as Address;

describe("EnsResolver", () => {
  describe("getAddress", () => {
    it.effect("successfully resolves ENS name to address", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const result = yield* resolver.getAddress(TEST_ENS_NAME);

        expect(result).toBe(TEST_ADDRESS);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsAddress: () => Promise.resolve(TEST_ADDRESS),
            })
          )
        )
      )
    );

    it.effect("returns EnsNameNotFoundError when name not found", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const exit = yield* resolver.getAddress("nonexistent.eth").pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
        if (Exit.isFailure(exit)) {
          const cause = exit.cause;
          expect(cause._tag).toBe("Fail");
        }
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsAddress: () => Promise.resolve(null),
            })
          )
        )
      )
    );

    it.effect("returns EnsResolutionError when resolution throws", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const exit = yield* resolver.getAddress(TEST_ENS_NAME).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsAddress: () => Promise.reject(new Error("RPC error")),
            })
          )
        )
      )
    );

    it.effect("supports coinType parameter for cross-chain resolution", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const result = yield* resolver.getAddress(TEST_ENS_NAME, {
          coinType: 60n,
        });

        expect(result).toBe(TEST_ADDRESS);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsAddress: (params: unknown) => {
                // Verify coinType is passed through
                const p = params as { coinType?: bigint };
                expect(p.coinType).toBe(60n);
                return Promise.resolve(TEST_ADDRESS);
              },
            })
          )
        )
      )
    );
  });

  describe("getName", () => {
    it.effect("successfully reverse resolves address to ENS name", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const result = yield* resolver.getName(TEST_ADDRESS);

        expect(result).toBe(TEST_ENS_NAME);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsName: async () => TEST_ENS_NAME,
            })
          )
        )
      )
    );

    it.effect("returns EnsReverseNameNotFoundError when no name found", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const exit = yield* resolver.getName(TEST_ADDRESS).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsName: async () => null,
            })
          )
        )
      )
    );
  });

  describe("getAvatar", () => {
    it.effect("successfully retrieves ENS avatar URL", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const result = yield* resolver.getAvatar(TEST_ENS_NAME);

        expect(result).toBe(TEST_ENS_AVATAR);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsAvatar: async () => TEST_ENS_AVATAR,
            })
          )
        )
      )
    );

    it.effect("returns EnsAvatarNotFoundError when no avatar found", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const exit = yield* resolver.getAvatar(TEST_ENS_NAME).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsAvatar: async () => null,
            })
          )
        )
      )
    );
  });

  describe("getText", () => {
    it.effect("successfully retrieves ENS text record", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const result = yield* resolver.getText(TEST_ENS_NAME, "com.twitter");

        expect(result).toBe(TEST_ENS_TEXT);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsText: async () => TEST_ENS_TEXT,
            })
          )
        )
      )
    );

    it.effect("returns EnsTextNotFoundError when no text record found", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const exit = yield* resolver.getText(TEST_ENS_NAME, "nonexistent.key").pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsText: async () => null,
            })
          )
        )
      )
    );
  });

  describe("getResolver", () => {
    it.effect("successfully retrieves ENS resolver address", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const result = yield* resolver.getResolver(TEST_ENS_NAME);

        expect(result).toBe(TEST_RESOLVER_ADDRESS);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsResolver: async () => TEST_RESOLVER_ADDRESS,
            })
          )
        )
      )
    );

    it.effect("returns EnsResolverNotConfiguredError when no resolver found", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const exit = yield* resolver.getResolver(TEST_ENS_NAME).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsResolver: async () => null,
            })
          )
        )
      )
    );

    it.effect("returns EnsResolverNotConfiguredError for zero address", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const exit = yield* resolver.getResolver(TEST_ENS_NAME).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            makeMockPublicClientLayer({
              getEnsResolver: async () => "0x0000000000000000000000000000000000000000",
            })
          )
        )
      )
    );
  });

  describe("ClientNotFoundError", () => {
    it.effect("returns ClientNotFoundError when mainnet not configured", () =>
      Effect.gen(function* () {
        const resolver = yield* EnsResolver;
        const exit = yield* resolver.getAddress(TEST_ENS_NAME).pipe(Effect.exit);

        expect(Exit.isFailure(exit)).toBe(true);
      }).pipe(
        Effect.provide(
          Layer.provide(
            EnsResolverLive,
            // Mock configured for chainId 99999 instead of mainnet (1)
            makeMockPublicClientLayer({}, 99_999)
          )
        )
      )
    );
  });
});
