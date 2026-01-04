import "server-only";

import { OtlpMetrics, OtlpTracer } from "@effect/opentelemetry";
import { FetchHttpClient } from "@effect/platform";
import type * as Headers from "@effect/platform/Headers";
import type * as HttpClient from "@effect/platform/HttpClient";
import { Layer } from "effect";
import type * as Duration from "effect/Duration";

/**
 * @category models
 */
export type OtelResource = {
  readonly serviceName?: string;
  readonly serviceVersion?: string;
  readonly attributes?: Record<string, unknown>;
};

/**
 * @category models
 */
export type OtelExporterConfig = {
  readonly url: string;
  readonly headers?: Headers.Input;
  readonly exportInterval?: Duration.DurationInput;
  readonly shutdownTimeout?: Duration.DurationInput;
  readonly maxBatchSize?: number;
};

/**
 * @category models
 */
export type OtelLayerOptions = {
  readonly enabled?: boolean;
  readonly traces?: OtelExporterConfig | false;
  readonly metrics?: OtelExporterConfig | false;
  readonly resource?: OtelResource;
  readonly provideHttpClient?: boolean;
};

type OtelLayer = Layer.Layer<never, never, HttpClient.HttpClient>;

/**
 * Creates an OpenTelemetry layer using OTLP exporters.
 *
 * @category layers
 */
export function createOtelLayer(
  options: OtelLayerOptions & { provideHttpClient: false }
): OtelLayer;
export function createOtelLayer(options: OtelLayerOptions): Layer.Layer<never, never, never>;
export function createOtelLayer(options: OtelLayerOptions) {
  if (options.enabled === false) {
    return Layer.empty;
  }

  const resource = options.resource;

  const tracesLayer: OtelLayer = options.traces
    ? OtlpTracer.layer({
        exportInterval: options.traces.exportInterval,
        headers: options.traces.headers,
        maxBatchSize: options.traces.maxBatchSize,
        resource,
        shutdownTimeout: options.traces.shutdownTimeout,
        url: options.traces.url,
      })
    : (Layer.empty as OtelLayer);

  const metricsLayer: OtelLayer = options.metrics
    ? OtlpMetrics.layer({
        exportInterval: options.metrics.exportInterval,
        headers: options.metrics.headers,
        resource,
        shutdownTimeout: options.metrics.shutdownTimeout,
        url: options.metrics.url,
      })
    : (Layer.empty as OtelLayer);

  const merged: OtelLayer = Layer.mergeAll(tracesLayer, metricsLayer);
  if (options.provideHttpClient === false) {
    return merged;
  }
  return merged.pipe(Layer.provide(FetchHttpClient.layer));
}
