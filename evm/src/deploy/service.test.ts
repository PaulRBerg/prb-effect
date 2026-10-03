import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { WalletClientService } from "#src/core/index.js";
import { DeployService, DeployServiceLive } from "#src/deploy/index.js";
import {
  makeMockGasServiceLayer,
  makeMockPublicClientLayer,
  makeMockWalletClientLayer,
  TEST_ADDRESS,
  TEST_CHAIN_ID,
} from "#src/testing-kit/index.js";
import { TxManager } from "#src/tx/index.js";

const rejectingWallet = Layer.provide(
  Layer.effect(
    WalletClientService,
    Effect.gen(function* () {
      const base = yield* WalletClientService;
      return WalletClientService.of({
        get: (chainId) =>
          base.get(chainId).pipe(
            Effect.map((client) => ({
              ...client,
              deployContract: () => Promise.reject("wallet disconnected"),
            }))
          ),
      });
    })
  ),
  makeMockWalletClientLayer()
);

describe("deployment error mapping", () => {
  it.effect("preserves non-Error wallet rejections as typed deployment failures", () =>
    Effect.gen(function* () {
      const service = yield* DeployService;
      const params = {
        abi: [],
        account: TEST_ADDRESS,
        bytecode: "0x00",
        chainId: TEST_CHAIN_ID,
      } as const;
      const direct = yield* service.deploy(params).pipe(Effect.flip);
      expect(direct._tag).toBe("DeploymentError");
      expect(direct.message).toBe("wallet disconnected");
      const execution = yield* service.deployAndTrack(params);
      const tracked = yield* execution.result.pipe(Effect.flip);
      expect(tracked._tag).toBe("DeploymentError");
      expect(tracked.message).toBe("wallet disconnected");
    }).pipe(
      Effect.scoped,
      Effect.provide(
        Layer.provide(
          DeployServiceLive,
          Layer.mergeAll(
            makeMockPublicClientLayer(),
            makeMockGasServiceLayer(),
            rejectingWallet,
            Layer.succeed(TxManager, {
              getConfirmations: () => Effect.die("Unexpected confirmation lookup"),
              track: () => Effect.die("Unexpected tracking"),
              waitForReceipt: () => Effect.die("Unexpected receipt lookup"),
            })
          )
        )
      )
    )
  );
});
