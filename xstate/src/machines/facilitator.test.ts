import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { createActor, waitFor } from "xstate";

const { createFacilitatorMachine } = await import("./facilitator.js");

describe("machines/facilitator", () => {
  it("CHECK caches status + transitive and transitions to checked", async () => {
    const onCheck = vi.fn((_: { user: string }) =>
      Effect.succeed({ status: "true" as const, transitive: { proof: "0xabc" } })
    );

    const machine = createFacilitatorMachine<
      { user: string },
      { claim: string },
      { proof: string }
    >({
      id: "eligibility",
      services: {
        onCheck,
        onCreate: () => Effect.succeed(undefined),
      },
    });

    const actor = createActor(machine).start();
    actor.send({ payload: { user: "alice" }, type: "CHECK" });

    const snapshot = await waitFor(actor, (s) => s.value === "checked", { timeout: 1000 });
    expect(onCheck).toHaveBeenCalledWith({ user: "alice" });
    expect(snapshot.context.status).toBe("true");
    expect(snapshot.context.transitive).toEqual({ proof: "0xabc" });
  });

  it("CREATE passes transitive to onCreate and transitions to created", async () => {
    const onCreate = vi.fn(
      (_input: { create: { claim: string }; transitive: { proof: string } | null }) =>
        Effect.succeed(undefined)
    );

    const machine = createFacilitatorMachine<
      { user: string },
      { claim: string },
      { proof: string }
    >({
      id: "create",
      services: {
        onCheck: () => Effect.succeed({ status: "true" as const, transitive: { proof: "0xdef" } }),
        onCreate,
      },
    });

    const actor = createActor(machine).start();
    actor.send({ payload: { user: "alice" }, type: "CHECK" });
    await waitFor(actor, (s) => s.value === "checked", { timeout: 1000 });

    actor.send({ payload: { claim: "airdrop" }, type: "CREATE" });
    await waitFor(actor, (s) => s.value === "created", { timeout: 1000 });

    expect(onCreate).toHaveBeenCalledTimes(1);
    expect(onCreate).toHaveBeenCalledWith({
      create: { claim: "airdrop" },
      transitive: { proof: "0xdef" },
    });
  });

  it("sets error and transitions to failed when check fails", async () => {
    const machine = createFacilitatorMachine<{ user: string }, never, never>({
      id: "check-fail",
      services: {
        onCheck: () => Effect.fail(new Error("not eligible")),
        onCreate: () => Effect.fail(new Error("unreachable")),
      },
    });

    const actor = createActor(machine).start();
    actor.send({ payload: { user: "alice" }, type: "CHECK" });

    const snapshot = await waitFor(actor, (s) => s.value === "failed", { timeout: 1000 });
    expect(snapshot.context.error).toBe("not eligible");
    expect(snapshot.context.status).toBe("idle");
  });

  it("RESET returns to idle and clears cached transitive", async () => {
    const machine = createFacilitatorMachine<{ user: string }, never, { proof: string }>({
      id: "reset",
      services: {
        onCheck: () => Effect.succeed({ status: "true" as const, transitive: { proof: "0xabc" } }),
        onCreate: () => Effect.succeed(undefined),
      },
    });

    const actor = createActor(machine).start();
    actor.send({ payload: { user: "alice" }, type: "CHECK" });
    await waitFor(actor, (s) => s.value === "checked", { timeout: 1000 });

    actor.send({ type: "RESET" });
    const snapshot = await waitFor(actor, (s) => s.value === "idle", { timeout: 1000 });
    expect(snapshot.context.transitive).toBe(null);
    expect(snapshot.context.status).toBe("idle");
  });
});
