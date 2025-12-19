import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";

const useActorMock = vi.fn();
vi.mock("@xstate/react", () => ({ useActor: useActorMock }));

const { useFormWorkflow } = await import("./useFormWorkflow.js");

describe("hooks/useFormWorkflow", () => {
  it("maps snapshot.value and context into derived status flags", () => {
    const send = vi.fn();
    useActorMock.mockReturnValueOnce([
      {
        context: { error: "boom", payload: { a: 1 }, preprocess: { p: true }, result: null },
        value: "process",
      },
      send,
    ]);

    const api = useFormWorkflow<any, any, any, any>({} as any);

    expect(api.state).toBe("process");
    expect(api.error).toBe("boom");
    expect(api.status.isProcessing).toBe(true);
    expect(api.status.isLoading).toBe(true);
    expect(api.status.isSuccess).toBe(false);
    expect(api.preprocess).toEqual({ p: true });
  });

  it("sends CHECK/SAVE/RESET events with payloads", () => {
    const send = vi.fn();
    useActorMock.mockReturnValueOnce([
      {
        context: { error: null, payload: {}, preprocess: undefined, result: null },
        value: "initial",
      },
      send,
    ]);

    const api = useFormWorkflow<{ dep: string }, { value: number }, { ok: true }, undefined>(
      {} as any
    );

    api.check({ dep: "wallet" });
    api.save({ value: 1 });
    api.reset();

    expect(send).toHaveBeenCalledWith({ payload: { dep: "wallet" }, type: "CHECK" });
    expect(send).toHaveBeenCalledWith({ payload: { value: 1 }, type: "SAVE" });
    expect(send).toHaveBeenCalledWith({ type: "RESET" });
  });
});
