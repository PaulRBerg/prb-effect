import { describe, expect, it } from "@effect/vitest";
import { Effect, Fiber, Layer, Stream } from "effect";
import { makeWalletProviderRefLive, WalletProviderRef } from "./provider-ref.js";
import { WalletService, WalletServiceFromProviderRefLive } from "./service.js";
import type { WalletProvider } from "./types.js";

const cases = [
  { event: "accountsChanged", newValue: ["0xnew"], oldValue: ["0xold"], stream: "accounts" },
  { event: "chainChanged", newValue: "0x89", oldValue: "0x1", stream: "chainId" },
] as const;

describe("wallet provider streams", () => {
  for (const testCase of cases) {
    it.effect(
      `${testCase.stream} unsubscribes replaced providers and ignores late requests`,
      () => {
        const seen: unknown[] = [];
        const removals: string[] = [];
        let oldListener: ((...args: unknown[]) => void) | undefined;
        const { promise: oldRegistered, resolve: notifyOldRegistered } =
          Promise.withResolvers<void>();
        const { promise: newValueReceived, resolve: notifyNewValue } =
          Promise.withResolvers<void>();
        const { promise: oldRequest, resolve: resolveOld } = Promise.withResolvers<unknown>();
        const oldProvider: WalletProvider = {
          on: (event, listener) => {
            expect(event).toBe(testCase.event);
            oldListener = listener;
            notifyOldRegistered();
          },
          removeListener: (event, listener) => {
            expect(listener).toBe(oldListener);
            removals.push(`old:${event}`);
          },
          request: () => oldRequest,
        };
        const newProvider: WalletProvider = {
          on: () => undefined,
          removeListener: (event) => {
            removals.push(`new:${event}`);
          },
          request: () => Promise.resolve(testCase.newValue),
        };
        const refLayer = makeWalletProviderRefLive(oldProvider);
        const layer = Layer.provideMerge(WalletServiceFromProviderRefLive, refLayer);

        return Effect.gen(function* () {
          const providerRef = yield* WalletProviderRef;
          const service = yield* WalletService;
          const stream: Stream.Stream<unknown> = yield* service[testCase.stream];
          const fiber = yield* Stream.runForEach(stream, (value) =>
            Effect.sync(() => {
              seen.push(value);
              notifyNewValue();
            })
          ).pipe(Effect.forkScoped);
          yield* Effect.promise(() => oldRegistered);
          yield* providerRef.set(newProvider);
          yield* Effect.promise(() => newValueReceived);
          expect(removals).toEqual([`old:${testCase.event}`]);

          oldListener?.(testCase.oldValue);
          resolveOld(testCase.oldValue);
          yield* Effect.promise(async () => {
            await oldRequest;
            await Promise.resolve();
          });
          expect(seen).toEqual([testCase.stream === "accounts" ? testCase.newValue : 137]);

          yield* Fiber.interrupt(fiber);
          expect(removals).toEqual([`old:${testCase.event}`, `new:${testCase.event}`]);
        }).pipe(Effect.provide(layer));
      }
    );
  }
});
