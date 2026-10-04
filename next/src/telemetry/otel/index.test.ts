import { describe, expect, it } from "@effect/vitest";
import { Context, Deferred, Effect, Fiber, Layer, ManagedRuntime, Metric } from "effect";
import type { HttpClientRequest } from "effect/http";
import { HttpClient, HttpClientResponse } from "effect/http";
import { OtlpExporter } from "effect/observability";
import { TestClock } from "effect/testing";
import { expectTypeOf, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { createOtelLayer } = await import("./index.js");

function makeRecordingClient() {
  const requests: HttpClientRequest.HttpClientRequest[] = [];
  const client = HttpClient.make((request) =>
    Effect.sync(() => {
      requests.push(request);
      return HttpClientResponse.fromWeb(request, new Response("{}", { status: 200 }));
    })
  );
  return { requests, layer: Layer.succeed(HttpClient.HttpClient, client) };
}

function payload(request: HttpClientRequest.HttpClientRequest) {
  if (request.body._tag !== "Uint8Array") throw new Error("Expected JSON request body");
  return JSON.parse(new TextDecoder().decode(request.body.body));
}

describe("OTLP layer", () => {
  it("disabled exporters need no client and install no flusher", async () => {
    const layer = createOtelLayer({
      enabled: false,
      provideHttpClient: false,
      traces: { url: "https://telemetry.invalid/traces" },
    });
    expectTypeOf(layer).toEqualTypeOf<Layer.Layer<never>>();
    const runtime = ManagedRuntime.make(layer);
    try {
      const context = await runtime.runPromise(Effect.context());
      expect(Context.getOption(context, OtlpExporter.Flusher)._tag).toBe("None");
      expect(Context.getOption(context, HttpClient.HttpClient)._tag).toBe("None");
    } finally {
      await runtime.dispose();
    }
  });

  it("no configured signals need no client or exporter", async () => {
    const layer = createOtelLayer({ metrics: false, provideHttpClient: false, traces: false });
    expectTypeOf(layer).toEqualTypeOf<Layer.Layer<never>>();
    const runtime = ManagedRuntime.make(layer);
    try {
      const context = await runtime.runPromise(Effect.context());
      expect(Context.getOption(context, OtlpExporter.Flusher)._tag).toBe("None");
    } finally {
      await runtime.dispose();
    }
  });

  it("uses a custom client, exports JSON resource configuration, and flushes on shutdown", async () => {
    const recorded = makeRecordingClient();
    const layer = createOtelLayer({
      provideHttpClient: false,
      resource: {
        attributes: { region: "local" },
        serviceName: "next-test",
        serviceVersion: "2.0.0",
      },
      traces: {
        exportInterval: "1 hour",
        headers: { "x-test-token": "local-fixture" },
        maxBatchSize: 100,
        shutdownTimeout: "100 millis",
        url: "https://telemetry.invalid/traces",
      },
    });
    expectTypeOf(layer).toEqualTypeOf<
      Layer.Layer<OtlpExporter.Flusher, never, HttpClient.HttpClient>
    >();
    const runtime = ManagedRuntime.make(layer.pipe(Layer.provide(recorded.layer)));
    try {
      await runtime.runPromise(Effect.void.pipe(Effect.withSpan("explicit-flush")));
      expect(recorded.requests).toHaveLength(0);
      await runtime.runPromise(Effect.flatMap(OtlpExporter.Flusher, (flusher) => flusher.flush));
      expect(recorded.requests).toHaveLength(1);
      const request = recorded.requests[0];
      expect(request.url).toBe("https://telemetry.invalid/traces");
      expect(request.headers["x-test-token"]).toBe("local-fixture");
      expect(request.headers["content-type"]).toContain("application/json");
      const trace = payload(request).resourceSpans[0];
      expect(trace.resource.attributes).toEqual(
        expect.arrayContaining([
          { key: "service.name", value: { stringValue: "next-test" } },
          { key: "service.version", value: { stringValue: "2.0.0" } },
          { key: "region", value: { stringValue: "local" } },
        ])
      );
      expect(trace.scopeSpans[0].spans[0].name).toBe("explicit-flush");
      await runtime.runPromise(Effect.void.pipe(Effect.withSpan("shutdown-flush")));
    } finally {
      await runtime.dispose();
    }
    expect(recorded.requests).toHaveLength(2);
    expect(payload(recorded.requests[1]).resourceSpans[0].scopeSpans[0].spans[0].name).toBe(
      "shutdown-flush"
    );
  });

  it.effect("bounds shutdown and interrupts an export that never completes", () =>
    Effect.gen(function* () {
      const started = yield* Deferred.make<void>();
      let finalized = false;
      const client = HttpClient.make(() =>
        Effect.andThen(Deferred.succeed(started, undefined), Effect.never).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              finalized = true;
            })
          )
        )
      );
      const layer = createOtelLayer({
        provideHttpClient: false,
        resource: { serviceName: "shutdown-timeout-fixture" },
        traces: {
          exportInterval: "1 hour",
          shutdownTimeout: "100 millis",
          url: "https://telemetry.invalid/traces",
        },
      }).pipe(Layer.provide(Layer.succeed(HttpClient.HttpClient, client)));
      const closing = yield* Effect.forkChild(
        Effect.void.pipe(Effect.withSpan("pending-export"), Effect.provide(layer))
      );
      yield* Deferred.await(started);
      yield* TestClock.adjust("100 millis");
      yield* Fiber.join(closing);
      expect(finalized).toBe(true);
    })
  );

  it("shares a flusher across trace and metric exporters", async () => {
    const recorded = makeRecordingClient();
    const layer = createOtelLayer({
      metrics: { exportInterval: "1 hour", url: "https://telemetry.invalid/metrics" },
      provideHttpClient: false,
      resource: { serviceName: "paired-fixture" },
      traces: { exportInterval: "1 hour", url: "https://telemetry.invalid/traces" },
    }).pipe(
      Layer.provide(recorded.layer),
      Layer.provideMerge(Layer.succeed(Metric.MetricRegistry, new Map()))
    );
    const runtime = ManagedRuntime.make(layer);
    try {
      await runtime.runPromise(
        Effect.gen(function* () {
          yield* Metric.update(Metric.counter("next_otel_local_fixture"), 1);
          yield* Effect.void.pipe(Effect.withSpan("paired-export"));
          const flusher = yield* OtlpExporter.Flusher;
          yield* flusher.flush;
        })
      );
      expect(recorded.requests.map((request) => request.url)).toEqual(
        expect.arrayContaining([
          "https://telemetry.invalid/traces",
          "https://telemetry.invalid/metrics",
        ])
      );
      const metrics = recorded.requests.find((request) => request.url.endsWith("/metrics"));
      expect(metrics && payload(metrics).resourceMetrics[0].scopeMetrics[0].metrics).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "next_otel_local_fixture",
            sum: expect.objectContaining({
              dataPoints: [expect.objectContaining({ asDouble: 1 })],
            }),
          }),
        ])
      );
    } finally {
      await runtime.dispose();
    }
  });
});
