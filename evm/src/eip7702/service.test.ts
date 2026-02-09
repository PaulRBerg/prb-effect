import { describe, expect, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import { Eip7702Service, Eip7702ServiceLive } from "#src/eip7702/index.js";
import {
  makeMockPublicClientLayer,
  makeMockWalletClientLayer,
  TEST_ADDRESS,
  TEST_ADDRESS_2,
  TEST_CHAIN_ID,
  TEST_TX_HASH,
} from "#src/testing-kit/index.js";
import { TxManager } from "#src/tx/index.js";

describe("Eip7702Service", () => {
  it.effect("sends an eip7702 tx to self with an unsigned authorization", () =>
    Effect.gen(function* () {
      const eip7702 = yield* Eip7702Service;

      const hash = yield* eip7702.delegateAndExecuteErc7579Batch({
        calls: [{ data: "0x1234", to: TEST_ADDRESS_2 }],
        chainId: TEST_CHAIN_ID,
        delegation: TEST_ADDRESS_2,
      });

      expect(hash).toBe(TEST_TX_HASH);
    }).pipe(
      Effect.provide(
        Layer.provide(
          Eip7702ServiceLive,
          Layer.mergeAll(
            makeMockPublicClientLayer({
              getTransactionCount: async () => 41,
            }),
            makeMockWalletClientLayer({
              accountAddress: TEST_ADDRESS,
              sendTransaction: (params) => {
                const p = params as {
                  account: { address: string };
                  authorizationList: Array<{
                    address: string;
                    chainId: number;
                    nonce: number;
                  }>;
                  to: string;
                  type: string;
                };

                expect(p.type).toBe("eip7702");
                expect(p.to).toBe(TEST_ADDRESS);
                expect(p.authorizationList[0].address).toBe(TEST_ADDRESS_2);
                expect(p.authorizationList[0].chainId).toBe(TEST_CHAIN_ID);
                expect(p.authorizationList[0].nonce).toBe(42);

                return Promise.resolve(TEST_TX_HASH);
              },
            }),
            Layer.succeed(
              TxManager,
              TxManager.of({
                getConfirmations: () => Effect.die("not used"),
                track: () => Effect.die("not used"),
                waitForReceipt: () => Effect.die("not used"),
              })
            )
          )
        )
      )
    )
  );
});
