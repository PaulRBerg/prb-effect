import { describe, expect, it } from "@effect/vitest";
import { Effect, Exit } from "effect";
import {
  catchUserRejection,
  catchUserRejectionWith,
  isLikelyUserRejectedError,
  isTaggedUserRejectedError,
  isUserRejectedError,
  TransactionFailedError,
  TransactionSendError,
  UserRejectedError,
} from "./transaction.js";
import { SignatureError, WalletNotConnectedError } from "./wallet.js";

// =============================================================================
// isUserRejectedError / isTaggedUserRejectedError
// =============================================================================

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
    const error = new TransactionFailedError({
      message: "Transaction failed",
      signature: "abc123",
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

describe("isTaggedUserRejectedError", () => {
  it("returns true for UserRejectedError instance", () => {
    const error = new UserRejectedError({ message: "User rejected" });
    expect(isTaggedUserRejectedError(error)).toBe(true);
  });

  it("returns true for object with matching _tag", () => {
    const error = { _tag: "UserRejectedError", message: "User rejected" };
    expect(isTaggedUserRejectedError(error)).toBe(true);
  });

  it("returns false for other TaggedError", () => {
    const error = new TransactionSendError({ message: "Send failed" });
    expect(isTaggedUserRejectedError(error)).toBe(false);
  });

  it("returns false for EIP-1193 rejection code without _tag", () => {
    expect(isTaggedUserRejectedError({ code: 4001, message: "Request rejected" })).toBe(false);
  });
});

// =============================================================================
// isLikelyUserRejectedError
// =============================================================================

describe("isLikelyUserRejectedError", () => {
  describe("tagged errors", () => {
    it("returns true for UserRejectedError instance", () => {
      const error = new UserRejectedError({ message: "User rejected" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns true for WalletNotConnectedError (treat as cancellation)", () => {
      const error = new WalletNotConnectedError({ message: "Wallet not connected" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns false for other tagged errors", () => {
      const error = new TransactionFailedError({
        message: "Transaction failed",
        signature: "abc123",
      });
      expect(isLikelyUserRejectedError(error)).toBe(false);
    });
  });

  describe("SignatureError with code 4001", () => {
    it("returns true for SignatureError with code 4001 in cause", () => {
      const cause = { code: 4001, message: "User rejected the request" };
      const error = new SignatureError({ cause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns true for SignatureError with string code 4001", () => {
      const cause = { code: "4001", message: "User rejected" };
      const error = new SignatureError({ cause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns true for SignatureError with Error cause having code 4001", () => {
      const cause = Object.assign(new Error("User rejected"), { code: 4001 });
      const error = new SignatureError({ cause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns false for SignatureError with different code", () => {
      const cause = { code: 5000, message: "Some other error" };
      const error = new SignatureError({ cause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(false);
    });
  });

  describe("SignatureError with rejection message", () => {
    it("returns true for cause with 'user rejected' message", () => {
      const cause = { message: "User rejected the transaction" };
      const error = new SignatureError({ cause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns true for cause with 'rejected the request' message", () => {
      const cause = { message: "The user rejected the request" };
      const error = new SignatureError({ cause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns true for string cause with rejection message", () => {
      const error = new SignatureError({ cause: "user rejected", message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns true for Error cause with rejection message", () => {
      const cause = new Error("User rejected the request");
      const error = new SignatureError({ cause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns false for unrelated message", () => {
      const cause = { message: "Network timeout" };
      const error = new SignatureError({ cause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(false);
    });
  });

  describe("nested cause detection", () => {
    it("returns true for nested Error with code 4001", () => {
      const innerCause = Object.assign(new Error("User rejected"), { code: 4001 });
      const outerCause = new Error("Outer", { cause: innerCause });
      const error = new SignatureError({ cause: outerCause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("returns true for nested Error with rejection message", () => {
      const innerCause = new Error("User rejected the request");
      const outerCause = new Error("Outer", { cause: innerCause });
      const error = new SignatureError({ cause: outerCause, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });

    it("stops at depth > 3 to prevent infinite recursion", () => {
      // Create a deeply nested cause chain (5 levels deep)
      // checkCause is called with depth 0 for SignatureError.cause
      // depth 0: level1, depth 1: level2, depth 2: level3, depth 3: level4
      // depth 4: deepCause would be checked but depth > 3 returns false before
      const deepCause = Object.assign(new Error("Deep user rejected"), { code: 4001 });
      const level4 = new Error("Level 4", { cause: deepCause });
      const level3 = new Error("Level 3", { cause: level4 });
      const level2 = new Error("Level 2", { cause: level3 });
      const level1 = new Error("Level 1", { cause: level2 });
      const error = new SignatureError({ cause: level1, message: "Signature failed" });
      // depth 4 > 3, so deepCause won't be found
      expect(isLikelyUserRejectedError(error)).toBe(false);
    });

    it("finds rejection at maximum allowed depth (3)", () => {
      // This should still be found (4 levels: 0, 1, 2, 3)
      const deepCause = Object.assign(new Error("Deep user rejected"), { code: 4001 });
      const level3 = new Error("Level 3", { cause: deepCause });
      const level2 = new Error("Level 2", { cause: level3 });
      const level1 = new Error("Level 1", { cause: level2 });
      const error = new SignatureError({ cause: level1, message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("returns false for null", () => {
      expect(isLikelyUserRejectedError(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(isLikelyUserRejectedError(undefined)).toBe(false);
    });

    it("returns false for plain string", () => {
      expect(isLikelyUserRejectedError("error")).toBe(false);
    });

    it("returns false for number", () => {
      expect(isLikelyUserRejectedError(4001)).toBe(false);
    });

    it("returns false for SignatureError without cause", () => {
      const error = new SignatureError({ message: "Signature failed" });
      expect(isLikelyUserRejectedError(error)).toBe(false);
    });
  });
});

// =============================================================================
// catchUserRejection
// =============================================================================

describe("catchUserRejection", () => {
  it.effect("returns fallback value on UserRejectedError", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
      const result = yield* catchUserRejection(effect, null);
      expect(result).toBe(null);
    })
  );

  it.effect("preserves success value", () =>
    Effect.gen(function* () {
      const effect = Effect.succeed("success");
      const result = yield* catchUserRejection(effect, null);
      expect(result).toBe("success");
    })
  );

  it.effect("propagates other errors", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(new Error("other"));
      const exit = yield* Effect.exit(catchUserRejection(effect, null));
      expect(Exit.isFailure(exit)).toBe(true);
    })
  );

  it.effect("propagates other TaggedErrors", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(
        new TransactionFailedError({
          message: "Transaction failed",
          signature: "abc123",
        })
      );
      const exit = yield* Effect.exit(catchUserRejection(effect, null));
      expect(Exit.isFailure(exit)).toBe(true);
      if (Exit.isFailure(exit)) {
        expect(exit.cause._tag).toBe("Fail");
      }
    })
  );

  it.effect("works with pipeable API", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
      const result = yield* effect.pipe(catchUserRejection(null));
      expect(result).toBe(null);
    })
  );

  it.effect("works with custom fallback value", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
      const result = yield* catchUserRejection(effect, { cancelled: true as const });
      expect(result).toEqual({ cancelled: true });
    })
  );
});

// =============================================================================
// catchUserRejectionWith
// =============================================================================

describe("catchUserRejectionWith", () => {
  it.effect("runs fallback effect on UserRejectedError", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
      const result = yield* catchUserRejectionWith(effect, Effect.succeed("cancelled"));
      expect(result).toBe("cancelled");
    })
  );

  it.effect("preserves success value", () =>
    Effect.gen(function* () {
      const effect = Effect.succeed("success");
      const result = yield* catchUserRejectionWith(effect, Effect.succeed("cancelled"));
      expect(result).toBe("success");
    })
  );

  it.effect("propagates other errors", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(new Error("other"));
      const exit = yield* Effect.exit(catchUserRejectionWith(effect, Effect.succeed("cancelled")));
      expect(Exit.isFailure(exit)).toBe(true);
    })
  );

  it.effect("works with pipeable API", () =>
    Effect.gen(function* () {
      const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
      const result = yield* effect.pipe(
        catchUserRejectionWith(Effect.succeed({ cancelled: true }))
      );
      expect(result).toEqual({ cancelled: true });
    })
  );

  it.effect("can run side effects in fallback", () => {
    let sideEffectRan = false;
    return Effect.gen(function* () {
      const effect = Effect.fail(new UserRejectedError({ message: "rejected" }));
      const result = yield* catchUserRejectionWith(
        effect,
        Effect.sync(() => {
          sideEffectRan = true;
          return "cancelled";
        })
      );
      expect(result).toBe("cancelled");
      expect(sideEffectRan).toBe(true);
    });
  });
});
