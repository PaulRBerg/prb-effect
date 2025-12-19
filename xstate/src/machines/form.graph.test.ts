import { describe, expect, it } from "@effect/vitest";
import { createActor, createMachine, waitFor } from "xstate";
import { createTestModel } from "xstate/graph";

const TIMEOUT = 1000;

describe("machines/form (graph)", () => {
  it("xstate/graph shortest paths can drive a form-like workflow model", async () => {
    const modelMachine = createMachine({
      id: "form-model",
      initial: "initial",
      states: {
        check: {
          on: {
            CHECK_DONE: { target: "initial" },
            CHECK_ERROR: { target: "initial" },
          },
        },
        failure: {
          on: {
            RESET: { target: "initial" },
            SAVE: { target: "validate" },
          },
        },
        initial: {
          on: {
            CHECK: { target: "check" },
            SAVE: { target: "validate" },
          },
        },
        process: {
          on: {
            PROCESS_ERROR: { target: "failure" },
            PROCESS_OK: { target: "success" },
          },
        },
        success: {
          on: {
            RESET: { target: "initial" },
            SAVE: { target: "validate" },
          },
        },
        validate: {
          on: {
            VALIDATE_ERROR: { target: "failure" },
            VALIDATE_OK: { target: "process" },
          },
        },
      },
    });

    const testModel = createTestModel(modelMachine);
    const paths = testModel.getShortestPaths({ allowDuplicatePaths: true });

    expect(paths.length).toBeGreaterThan(0);
    expect(paths.some((p) => p.state.matches("success"))).toBe(true);
    expect(paths.some((p) => p.state.matches("failure"))).toBe(true);

    const eventTypes = [
      "CHECK",
      "CHECK_DONE",
      "CHECK_ERROR",
      "PROCESS_ERROR",
      "PROCESS_OK",
      "RESET",
      "SAVE",
      "VALIDATE_ERROR",
      "VALIDATE_OK",
    ] as const;

    const makeEventExecutors = (actor: ReturnType<typeof createActor>) =>
      eventTypes.reduce(
        (acc, type) => {
          acc[type] = async (step) => {
            actor.send(step.event);
            await waitFor(actor, (snapshot) => snapshot.value === step.state.value, {
              timeout: TIMEOUT,
            });
          };
          return acc;
        },
        {} as Record<(typeof eventTypes)[number], (step: any) => Promise<void>>
      );

    for (const path of paths) {
      const actor = createActor(modelMachine).start();

      try {
        await path.test({
          events: makeEventExecutors(actor),
          states: {
            "*": (state) => {
              expect(actor.getSnapshot().value).toEqual(state.value);
            },
          },
        });
      } finally {
        actor.stop();
      }
    }
  });
});
