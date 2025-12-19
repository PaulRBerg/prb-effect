import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { createActor, waitFor } from "xstate";

const { createFormMachine } = await import("./form.js");

describe("machines/form", () => {
  it("CHECK invokes onCheck and returns to initial (reset)", async () => {
    const onCheck = vi.fn((_: { dep: string }) => Effect.succeed(undefined));

    const machine = createFormMachine<
      { dep: string },
      { name: string },
      { ok: true },
      { normalized: string }
    >({
      id: "check",
      services: {
        onCheck,
        onProcess: () => Effect.succeed({ ok: true }),
        onValidate: (payload) => Effect.succeed({ normalized: payload.name.toUpperCase() }),
      },
    });

    const actor = createActor(machine).start();
    expect(actor.getSnapshot().value).toBe("initial");

    actor.send({ payload: { dep: "wallet" }, type: "CHECK" });
    await waitFor(actor, (s) => s.value === "initial", { timeout: 1000 });

    expect(onCheck).toHaveBeenCalledTimes(1);
    expect(onCheck).toHaveBeenCalledWith({ dep: "wallet" });
    expect(actor.getSnapshot().context.error).toBe(null);
  });

  it("SAVE runs validate → process → success and caches preprocess/result", async () => {
    const machine = createFormMachine<
      never,
      { count: number },
      { done: number },
      { doubled: number }
    >({
      id: "success",
      services: {
        onCheck: () => Effect.succeed(undefined),
        onProcess: ({ payload, preprocess }) =>
          Effect.succeed({ done: payload.count + preprocess.doubled }),
        onValidate: (payload) => Effect.succeed({ doubled: payload.count * 2 }),
      },
    });

    const actor = createActor(machine).start();
    actor.send({ payload: { count: 2 }, type: "SAVE" });

    const snapshot = await waitFor(actor, (s) => s.value === "success", { timeout: 1000 });

    expect(snapshot.context.error).toBe(null);
    expect(snapshot.context.preprocess).toEqual({ doubled: 4 });
    expect(snapshot.context.result).toEqual({ done: 6 });
  });

  it("SAVE goes to failure on validate error and exposes error message", async () => {
    const machine = createFormMachine<never, { count: number }, never, never>({
      id: "validate-fail",
      services: {
        onCheck: () => Effect.succeed(undefined),
        onProcess: () => Effect.fail(new Error("unreachable")),
        onValidate: () => Effect.fail(new Error("invalid payload")),
      },
    });

    const actor = createActor(machine).start();
    actor.send({ payload: { count: 1 }, type: "SAVE" });

    const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 1000 });
    expect(snapshot.context.error).toBe("invalid payload");
  });

  it("treats user-rejected process errors as cancel (reset to initial)", async () => {
    const machine = createFormMachine<never, { count: number }, never, { doubled: number }>({
      id: "user-reject",
      isUserRejectedError: (error) => error instanceof Error && error.message.includes("rejected"),
      services: {
        onCheck: () => Effect.succeed(undefined),
        onProcess: () => Effect.fail(new Error("User rejected request")),
        onValidate: (payload) => Effect.succeed({ doubled: payload.count * 2 }),
      },
    });

    const actor = createActor(machine).start();
    actor.send({ payload: { count: 2 }, type: "SAVE" });

    const snapshot = await waitFor(actor, (s) => s.value === "initial", { timeout: 1000 });
    expect(snapshot.context.error).toBe(null);
    expect(snapshot.context.result).toBe(null);
  });
});
