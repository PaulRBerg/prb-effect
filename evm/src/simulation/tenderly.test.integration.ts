import { describe, expect, it } from "@effect/vitest";
import { Cause, ConfigProvider, Effect, Exit, Layer, Option } from "effect";
import type { HttpClientRequest } from "effect/http";
import { HttpClient, HttpClientResponse } from "effect/http";
import type { Address, Hex } from "viem";
import { mainnet } from "viem/chains";
import {
  simulateTenderly,
  TenderlyApiError,
  TenderlyRateLimitError,
} from "#src/simulation/index.js";

const configProvider = ConfigProvider.fromEnvRecord({
  TENDERLY_ACCESS_KEY: "test-access-key",
  TENDERLY_ACCOUNT: "test-account",
  TENDERLY_PROJECT: "test-project",
});

const TEST_FROM = "0x1234567890123456789012345678901234567890" as Address;
const TEST_TO = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;

const makeMockHttpClientLayer = (params: {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
  onRequest?: (request: HttpClientRequest.HttpClientRequest) => void;
}) => {
  const client = {
    execute: (request: HttpClientRequest.HttpClientRequest) => {
      params.onRequest?.(request);
      return Effect.succeed(
        HttpClientResponse.fromWeb(
          request,
          new Response(JSON.stringify(params.body), {
            headers: params.headers,
            status: params.status,
          })
        )
      );
    },
  } as unknown as HttpClient.HttpClient;

  return Layer.succeed(HttpClient.HttpClient, client);
};

describe("Tenderly simulation", () => {
  it.effect("preserves explicit zero block, gas, and account nonce overrides", () =>
    simulateTenderly({
      blockNumber: 0n,
      chainId: mainnet.id,
      from: TEST_FROM,
      gas: 0n,
      stateOverrides: [{ address: TEST_FROM, nonce: 0n }],
      to: TEST_TO,
    }).pipe(
      Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
      Effect.provide(
        makeMockHttpClientLayer({
          body: { transaction: { gas: 0, gas_used: 0, status: true } },
          status: 200,
          onRequest: (request) => {
            expect(request.body._tag).toBe("Uint8Array");
            if (request.body._tag === "Uint8Array") {
              const body = JSON.parse(new TextDecoder().decode(request.body.body));
              expect(body.block_number).toBe(0);
              expect(body.gas).toBe(0);
              expect(body.state_objects[TEST_FROM].nonce).toBe(0);
            }
          },
        })
      )
    )
  );

  it.effect("maps returnValue from transaction.output (not input)", () =>
    Effect.gen(function* () {
      const layer = makeMockHttpClientLayer({
        status: 200,
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
      });

      const result = yield* simulateTenderly({
        chainId: mainnet.id,
        from: TEST_FROM,
        to: TEST_TO,
      }).pipe(
        Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
        Effect.provide(layer)
      );

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
        .pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
          Effect.provide(layer)
        )
        .pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.findErrorOption(exit.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) {
          expect(error.value).toBeInstanceOf(TenderlyRateLimitError);
          if (error.value instanceof TenderlyRateLimitError) {
            expect(error.value.retryAfter).toBe(120);
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
        .pipe(
          Effect.provideService(ConfigProvider.ConfigProvider, configProvider),
          Effect.provide(layer)
        )
        .pipe(Effect.exit);

      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        const error = Cause.findErrorOption(exit.cause);
        expect(Option.isSome(error)).toBe(true);
        if (Option.isSome(error)) {
          expect(error.value).toBeInstanceOf(TenderlyApiError);
          if (error.value instanceof TenderlyApiError) {
            expect(error.value.statusCode).toBe(500);
            expect(error.value.response).toEqual({ message: "bad" });
          }
        }
      }
    })
  );
});
