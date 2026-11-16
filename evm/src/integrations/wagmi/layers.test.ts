import { describe, expect, it } from "@effect/vitest";
import { createConfig } from "@wagmi/core";
import { Effect } from "effect";
import { http } from "viem";
import { mainnet } from "viem/chains";
import { vi } from "vitest";
import { WalletClientService } from "#src/core/index.js";
import { makeWalletClientLayerFromWagmi } from "./layers.js";

const { getWalletClientMock } = vi.hoisted(() => ({ getWalletClientMock: vi.fn() }));

vi.mock("@wagmi/core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@wagmi/core")>()),
  getWalletClient: getWalletClientMock,
}));

const config = createConfig({
  chains: [mainnet],
  transports: { [mainnet.id]: http("https://eth-mainnet.example.com") },
});

describe("makeWalletClientLayerFromWagmi", () => {
  it.effect("preserves a non-Error connector rejection as the cause", () => {
    const rejection = { code: 4100, message: "The requested account has not been authorized" };
    getWalletClientMock.mockRejectedValueOnce(rejection);

    return Effect.gen(function* () {
      const service = yield* WalletClientService;
      const error = yield* Effect.flip(service.get(1));

      expect(error._tag).toBe("WalletNotConnectedError");
      if (error._tag === "WalletNotConnectedError") {
        expect(error.cause).toBe(rejection);
        expect(error.message).toBe(
          "No wallet client available for chain 1: code 4100, The requested account has not been authorized"
        );
      }
    }).pipe(Effect.provide(makeWalletClientLayerFromWagmi(config)));
  });

  it.effect("keeps an Error rejection message and cause", () => {
    const rejection = new Error("Connector not connected.");
    getWalletClientMock.mockRejectedValueOnce(rejection);

    return Effect.gen(function* () {
      const service = yield* WalletClientService;
      const error = yield* Effect.flip(service.get(1));

      expect(error.message).toBe("Connector not connected.");
      expect(error._tag === "WalletNotConnectedError" && error.cause).toBe(rejection);
    }).pipe(Effect.provide(makeWalletClientLayerFromWagmi(config)));
  });
});
