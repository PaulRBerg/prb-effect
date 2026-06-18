import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";

const useActorMock = vi.fn();
vi.mock("@xstate/react", () => ({ useActor: useActorMock }));

const { useTxWorkflow } = await import("./useTxWorkflow.js");

describe("hooks/useTxWorkflow", () => {
  it("exposes structured error and errorMessage from context", () => {
    const send = vi.fn();
    const error = {
      message: "execution reverted",
      details: {
        address: "0xabc",
        calldata: "0xdeadbeef",
        cause: { nested: true },
        functionName: "transfer",
        sender: "0xdef",
        tag: "TxFailedError",
      },
    } as const;

    useActorMock.mockReturnValueOnce([
      {
        matches: vi.fn((value: string) => value === "failure"),
        value: "failure",
        context: {
          error,
          errorMessage: "execution reverted",
          gasLimit: 123_456n,
          gasLimitOverflow: null,
          hash: "0x123",
          payload: { amount: 1, isSafe: false },
          preprocess: { normalizedAmount: 1n, validated: true },
          result: null,
          signResult: { hash: "0x123" },
        },
      },
      send,
    ]);

    const api = useTxWorkflow<any, any, any, any>({} as any);

    expect(api.state).toBe("failure");
    expect(api.error).toEqual(error);
    expect(api.errorMessage).toBe("execution reverted");
    expect(api.status.isFailure).toBe(true);
    expect(api.status.isLoading).toBe(false);
  });

  it("sends SUBMIT and RESET events", () => {
    const send = vi.fn();
    useActorMock.mockReturnValueOnce([
      {
        matches: vi.fn((value: string) => value === "initial"),
        value: "initial",
        context: {
          error: null,
          errorMessage: null,
          gasLimit: undefined,
          gasLimitOverflow: null,
          hash: null,
          payload: null,
          preprocess: null,
          result: null,
          signResult: null,
        },
      },
      send,
    ]);

    const api = useTxWorkflow<{ amount: number }, unknown, unknown, unknown>({} as any);

    api.submit({ amount: 42 });
    api.reset();

    expect(send).toHaveBeenCalledWith({ payload: { amount: 42 }, type: "SUBMIT" });
    expect(send).toHaveBeenCalledWith({ type: "RESET" });
  });
});
