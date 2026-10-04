import "server-only";

import { Layer } from "effect";
import type * as Duration from "effect/Duration";
import type { Headers, HttpClient } from "effect/http";
import { FetchHttpClient } from "effect/http";
import type { OtlpExporter } from "effect/observability";
import { OtlpMetrics, OtlpSerialization, OtlpTracer } from "effect/observability";

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
  readonly exportInterval?: Duration.Input;
  readonly shutdownTimeout?: Duration.Input;
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

type RawOtelLayer = Layer.Layer<
  OtlpExporter.Flusher,
  never,
  HttpClient.HttpClient | OtlpSerialization.OtlpSerialization
>;
type OtelLayer = Layer.Layer<OtlpExporter.Flusher, never, HttpClient.HttpClient>;

/**
 * Creates an OpenTelemetry layer using OTLP exporters.
 *
 * @category layers
 */
export function createOtelLayer(
  options: OtelLayerOptions & ({ enabled: false } | { traces?: false; metrics?: false })
): Layer.Layer<never>;
export function createOtelLayer(
  options: OtelLayerOptions & { provideHttpClient?: true }
): Layer.Layer<OtlpExporter.Flusher>;
export function createOtelLayer(options: OtelLayerOptions): OtelLayer;
export function createOtelLayer(options: OtelLayerOptions) {
  if (options.enabled === false || !(options.traces || options.metrics)) {
    return Layer.empty;
  }

  const resource = options.resource;

  const tracesLayer: RawOtelLayer | Layer.Layer<never> = options.traces
    ? OtlpTracer.layer({
        exportInterval: options.traces.exportInterval,
        headers: options.traces.headers,
        maxBatchSize: options.traces.maxBatchSize,
        resource,
        shutdownTimeout: options.traces.shutdownTimeout,
        url: options.traces.url,
      })
    : Layer.empty;

  const metricsLayer: RawOtelLayer | Layer.Layer<never> = options.metrics
    ? OtlpMetrics.layer({
        exportInterval: options.metrics.exportInterval,
        headers: options.metrics.headers,
        resource,
        shutdownTimeout: options.metrics.shutdownTimeout,
        url: options.metrics.url,
      })
    : Layer.empty;

  const merged: OtelLayer = Layer.mergeAll(tracesLayer, metricsLayer).pipe(
    Layer.provide(OtlpSerialization.layerJson)
  );
  if (options.provideHttpClient === false) {
    return merged;
  }
  return merged.pipe(Layer.provide(FetchHttpClient.layer));
}
