import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import type { TelemetryAdapter } from "./index.js";

// Mock server-only
vi.mock("server-only", () => ({}));

const { TelemetryService, createTelemetryLayer } = await import("./index.js");

describe("telemetry service", () => {
  it("invokes adapter methods", async () => {
    const withScope = vi.fn(<A>(fn: (scope: unknown) => A) => fn({ scope: true }));
    const adapter: TelemetryAdapter = {
      captureException: vi.fn(),
      captureMessage: vi.fn(),
      setContext: vi.fn(),
      withScope: withScope as TelemetryAdapter["withScope"],
    };

    const layer = createTelemetryLayer(adapter);
    const program = Effect.gen(function* () {
      const telemetry = yield* TelemetryService;
      yield* telemetry.captureException(new Error("boom"), { requestId: "test" });
      yield* telemetry.captureMessage("hello");
      return yield* telemetry.withScope((scope) => (scope ? "ok" : "no"));
    }).pipe(Effect.provide(layer));

    const result = await Effect.runPromise(program);
    expect(result).toBe("ok");
    expect(adapter.captureException).toHaveBeenCalled();
    expect(adapter.captureMessage).toHaveBeenCalledWith("hello", undefined);
    expect(adapter.setContext).toHaveBeenCalledWith("effect", { requestId: "test" });
    expect(withScope).toHaveBeenCalled();
  });
});
