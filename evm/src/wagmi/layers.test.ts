import { describe, expect, it } from "@effect/vitest";
import { connect, createConfig as createCoreConfig } from "@wagmi/core";
import { Effect } from "effect";
import { http } from "viem";
import { mainnet, sepolia } from "viem/chains";
import { createConfig as createReactConfig, http as wagmiHttp } from "wagmi";
import { mainnet as wagmiMainnet } from "wagmi/chains";
import { mock } from "wagmi/connectors";
import { BalanceService } from "#src/balance/index.js";
import { BlockService } from "#src/block/index.js";
import { PublicClientService, WalletClientService } from "#src/core/index.js";
import { DeployService } from "#src/deploy/index.js";
import { Erc721Service } from "#src/erc721/index.js";
import { GasService } from "#src/gas/index.js";
import { NonceService } from "#src/nonce/index.js";
import { SignatureService } from "#src/signature/index.js";
import { SimulationService } from "#src/simulation/index.js";
import { SubscriptionService } from "#src/subscriptions/index.js";
import {
  makeEffectEvmLayerFromWagmi,
  makePublicClientLayerFromWagmi,
  makeWalletClientLayerFromWagmi,
} from "#src/wagmi/index.js";

describe("Wagmi preset layers", () => {
  it.effect("makePublicClientLayerFromWagmi provides public client", () =>
    Effect.gen(function* () {
      const service = yield* PublicClientService;
      const client = yield* service.get(1);
      expect(client.chain?.id).toBe(1);
    }).pipe(
      Effect.provide(
        makePublicClientLayerFromWagmi(
          createCoreConfig({
            chains: [mainnet, sepolia],
            transports: {
              [mainnet.id]: http("https://eth-mainnet.example.com"),
              [sepolia.id]: http("https://eth-sepolia.example.com"),
            },
          })
        )
      )
    )
  );

  it.effect(
    "makeWalletClientLayerFromWagmi maps missing connector to WalletNotConnectedError",
    () =>
      Effect.gen(function* () {
        const service = yield* WalletClientService;
        const exit = yield* service.get(1).pipe(Effect.exit);

        expect(exit._tag).toBe("Failure");
        if (exit._tag === "Failure") {
          expect(exit.cause._tag).toBe("Fail");
          if (exit.cause._tag === "Fail") {
            expect(exit.cause.error._tag).toBe("WalletNotConnectedError");
          }
        }
      }).pipe(
        Effect.provide(
          makeWalletClientLayerFromWagmi(
            createCoreConfig({
              chains: [mainnet],
              transports: {
                [mainnet.id]: http("https://eth-mainnet.example.com"),
              },
            })
          )
        )
      )
  );

  it.effect("accepts wagmi (React) config and provides wallet client after connect", () => {
    const connector = mock({
      accounts: ["0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266"],
    });

    const config = createReactConfig({
      chains: [wagmiMainnet],
      connectors: [connector],
      transports: {
        [wagmiMainnet.id]: wagmiHttp("https://eth-mainnet.example.com"),
      },
    });

    return Effect.gen(function* () {
      yield* Effect.promise(() => connect(config, { connector }));

      const service = yield* WalletClientService;
      const client = yield* service.get(wagmiMainnet.id);
      expect(client).toBeDefined();
    }).pipe(Effect.provide(makeWalletClientLayerFromWagmi(config)));
  });

  it.effect("makeEffectEvmLayerFromWagmi composes service layer", () =>
    Effect.gen(function* () {
      const publicClientService = yield* PublicClientService;
      const client = yield* publicClientService.get(1);
      expect(client).toBeDefined();

      // Services from effectEvmServices should be available
      expect(yield* BalanceService).toBeDefined();
      expect(yield* BlockService).toBeDefined();
      expect(yield* DeployService).toBeDefined();
      expect(yield* Erc721Service).toBeDefined();
      expect(yield* GasService).toBeDefined();
      expect(yield* NonceService).toBeDefined();
      expect(yield* SignatureService).toBeDefined();
      expect(yield* SimulationService).toBeDefined();
      expect(yield* SubscriptionService).toBeDefined();
    }).pipe(
      Effect.provide(
        makeEffectEvmLayerFromWagmi(
          createCoreConfig({
            chains: [mainnet],
            transports: {
              [mainnet.id]: http("https://eth-mainnet.example.com"),
            },
          })
        )
      )
    )
  );
});
