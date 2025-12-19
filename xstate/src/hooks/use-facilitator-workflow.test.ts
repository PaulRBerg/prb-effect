import { describe, expect, it } from "@effect/vitest";
import { vi } from "vitest";

const useActorMock = vi.fn();
vi.mock("@xstate/react", () => ({ useActor: useActorMock }));

const { useFacilitatorWorkflow } = await import("./useFacilitatorWorkflow.js");

describe("hooks/useFacilitatorWorkflow", () => {
  it("derives eligibility flags from context.status", () => {
    const send = vi.fn();
    useActorMock.mockReturnValueOnce([
      {
        context: { error: null, status: "expired", transitive: { proof: "0xabc" } },
        value: "checked",
      },
      send,
    ]);

    const api = useFacilitatorWorkflow<any, any, { proof: string }>({} as any);

    expect(api.state).toBe("checked");
    expect(api.eligibility).toBe("expired");
    expect(api.status.isExpired).toBe(true);
    expect(api.status.isEligible).toBe(false);
    expect(api.transitive).toEqual({ proof: "0xabc" });
  });

  it("sends CHECK/CREATE/RESET events with payloads", () => {
    const send = vi.fn();
    useActorMock.mockReturnValueOnce([
      { context: { error: null, status: "idle", transitive: null }, value: "idle" },
      send,
    ]);

    const api = useFacilitatorWorkflow<{ user: string }, { claim: string }, unknown>({} as any);

    api.check({ soft: true, user: "alice" });
    api.create({ claim: "airdrop" });
    api.reset();

    expect(send).toHaveBeenCalledWith({ payload: { soft: true, user: "alice" }, type: "CHECK" });
    expect(send).toHaveBeenCalledWith({ payload: { claim: "airdrop" }, type: "CREATE" });
    expect(send).toHaveBeenCalledWith({ type: "RESET" });
  });
});
