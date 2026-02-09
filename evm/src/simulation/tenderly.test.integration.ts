import type { HttpClientRequest } from "@effect/platform";
import { HttpClient, HttpClientResponse } from "@effect/platform";
import { describe, expect, it } from "@effect/vitest";
import { ConfigProvider, Effect, Exit, Layer } from "effect";
import type { Address, Hex } from "viem";
import { mainnet } from "viem/chains";
import {
  simulateTenderly,
  TenderlyApiError,
  TenderlyRateLimitError,
} from "#src/simulation/index.js";

const configProvider = ConfigProvider.fromMap(
  new Map([
    ["TENDERLY_ACCESS_KEY", "test-access-key"],
    ["TENDERLY_ACCOUNT", "test-account"],
    ["TENDERLY_PROJECT", "test-project"],
  ])
);

const TEST_FROM = "0x1234567890123456789012345678901234567890" as Address;
const TEST_TO = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;

const makeMockHttpClientLayer = (params: {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}) => {
  const client = {
    execute: (request: HttpClientRequest.HttpClientRequest) =>
      Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(params.body), {
            headers: params.headers,
            status: params.status,
          })
        )
      ),
  } as unknown as HttpClient.HttpClient;

  return Layer.succeed(HttpClient.HttpClient, client);
};

describe("Tenderly simulation", () => {
  it.effect("maps returnValue from transaction.output (not input)", () =>
    Effect.gen(function* () {
      const layer = makeMockHttpClientLayer({
        body: {
          logs: [],
          simulation: { id: "sim_1", status: true },
          transaction: {
            block_hash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            block_number: 123,
            cumulative_gas_used: 21_000,
            from: TEST_FROM,
            gas: 50_000,
            gas_price: "1",
            gas_used: 21_000,
            hash: "0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef",
            input: "0x1234",
            nonce: 0,
            output: "0xabcd",
            status: true,
            to: TEST_TO,
            value: "0",
          },
        },
        status: 200,
      });

      const result = yield* simulateTenderly({
        chainId: mainnet.id,
        from: TEST_FROM,
        to: TEST_TO,
      }).pipe(Effect.withConfigProvider(configProvider), Effect.provide(layer));

      expect(result.success).toBe(true);
      expect(result.returnValue).toBe("0xabcd" as Hex);
    })
  );

  it.effect("fails 429 as TenderlyRateLimitError with retryAfter", () =>
    Effect.gen(function* () {
      const layer = makeMockHttpClientLayer({
        body: { error: "rate limited" },
        headers: { "Retry-After": "120" },
        status: 429,
      });

      const exit = yield* simulateTenderly({
        chainId: mainnet.id,
        from: TEST_FROM,
        to: TEST_TO,
      })
        .pipe(Effect.withConfigProvider(configProvider), Effect.provide(layer))
        .pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        if (exit.cause._tag === "Fail") {
          expect(exit.cause.error).toBeInstanceOf(TenderlyRateLimitError);
          if (exit.cause.error instanceof TenderlyRateLimitError) {
            expect(exit.cause.error.retryAfter).toBe(120);
          }
        }
      }
    })
  );

  it.effect("fails non-2xx as TenderlyApiError with statusCode and response", () =>
    Effect.gen(function* () {
      const layer = makeMockHttpClientLayer({
        body: { message: "bad" },
        status: 500,
      });

      const exit = yield* simulateTenderly({
        chainId: mainnet.id,
        from: TEST_FROM,
        to: TEST_TO,
      })
        .pipe(Effect.withConfigProvider(configProvider), Effect.provide(layer))
        .pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
        if (exit.cause._tag === "Fail") {
          expect(exit.cause.error).toBeInstanceOf(TenderlyApiError);
          if (exit.cause.error instanceof TenderlyApiError) {
            expect(exit.cause.error.statusCode).toBe(500);
            expect(exit.cause.error.response).toEqual({ message: "bad" });
          }
        }
      }
    })
  );
});
