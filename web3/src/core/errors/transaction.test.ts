import { Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  catchUserRejection,
  catchUserRejectionWith,
  InsufficientFundsError,
  isUserRejectedError,
  UserRejectedError,
} from "./transaction.js";

describe("isUserRejectedError", () => {
  it("returns true for UserRejectedError instance", () => {
    const error = new UserRejectedError({ message: "User rejected" });
    expect(isUserRejectedError(error)).toBe(true);
  });

  it("returns true for object with matching _tag", () => {
    const error = { _tag: "UserRejectedError", message: "User rejected" };
    expect(isUserRejectedError(error)).toBe(true);
  });

  it("returns false for other TaggedError", () => {
    const error = new InsufficientFundsError({
      available: "0",
      message: "Not enough funds",
      required: "100",
    });
    expect(isUserRejectedError(error)).toBe(false);
  });

  it("returns false for plain Error", () => {
    expect(isUserRejectedError(new Error("other"))).toBe(false);
  });

  it("returns false for null", () => {
    expect(isUserRejectedError(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isUserRejectedError(undefined)).toBe(false);
  });

  it("returns false for object with different _tag", () => {
    expect(isUserRejectedError({ _tag: "OtherError" })).toBe(false);
  });
});

describe("catchUserRejection", () => {
  it("returns fallback value on UserRejectedError", async () => {
    const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
    const result = await Effect.runPromise(catchUserRejection(effect, null));
    expect(result).toBe(null);
  });

  it("preserves success value", async () => {
    const effect = Effect.succeed("success");
    const result = await Effect.runPromise(catchUserRejection(effect, null));
    expect(result).toBe("success");
  });

  it("propagates other errors", async () => {
    const effect = Effect.fail(new Error("other"));
    const exit = await Effect.runPromiseExit(catchUserRejection(effect, null));
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("propagates other TaggedErrors", async () => {
    const effect = Effect.fail(
      new InsufficientFundsError({
        available: "0",
        message: "Not enough",
        required: "100",
      })
    );
    const exit = await Effect.runPromiseExit(catchUserRejection(effect, null));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(exit.cause._tag).toBe("Fail");
    }
  });

  it("works with pipeable API", async () => {
    const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
    const result = await effect.pipe(catchUserRejection(null), Effect.runPromise);
    expect(result).toBe(null);
  });

  it("works with custom fallback value", async () => {
    const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
    const result = await Effect.runPromise(
      catchUserRejection(effect, { cancelled: true as const })
    );
    expect(result).toEqual({ cancelled: true });
  });
});

describe("catchUserRejectionWith", () => {
  it("runs fallback effect on UserRejectedError", async () => {
    const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
    const result = await Effect.runPromise(
      catchUserRejectionWith(effect, Effect.succeed("cancelled"))
    );
    expect(result).toBe("cancelled");
  });

  it("preserves success value", async () => {
    const effect = Effect.succeed("success");
    const result = await Effect.runPromise(
      catchUserRejectionWith(effect, Effect.succeed("cancelled"))
    );
    expect(result).toBe("success");
  });

  it("propagates other errors", async () => {
    const effect = Effect.fail(new Error("other"));
    const exit = await Effect.runPromiseExit(
      catchUserRejectionWith(effect, Effect.succeed("cancelled"))
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  it("works with pipeable API", async () => {
    const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
    const result = await effect.pipe(
      catchUserRejectionWith(Effect.succeed({ cancelled: true })),
      Effect.runPromise
    );
    expect(result).toEqual({ cancelled: true });
  });

  it("can run side effects in fallback", async () => {
    let sideEffectRan = false;
    const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
    const result = await Effect.runPromise(
      catchUserRejectionWith(
        effect,
        Effect.sync(() => {
          sideEffectRan = true;
          return "cancelled";
        })
      )
    );
    expect(result).toBe("cancelled");
    expect(sideEffectRan).toBe(true);
  });
});
