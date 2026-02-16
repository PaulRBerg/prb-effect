import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import {
  InstructionBuildError,
  InstructionNotFoundError,
  ProgramCreationError,
  ProgramReadError,
  ViewNotSupportedError,
} from "#src/program/index.js";
import {
  BlockhashExpiredError,
  SimulationFailedError,
  TransactionFailedError,
  TransactionSendError,
  TransactionTimeoutError,
  UserRejectedError,
} from "./transaction.js";
import { SignatureError, WalletNotConnectedError } from "./wallet.js";

describe("UserRejectedError", () => {
  it("has correct _tag", () => {
    const error = new UserRejectedError({ message: "User rejected" });
    expect(error._tag).toBe("UserRejectedError");
  });

  it("stores message", () => {
    const error = new UserRejectedError({ message: "User rejected the request" });
    expect(error.message).toBe("User rejected the request");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new UserRejectedError({ message: "test" })).pipe(
        Effect.catchTag("UserRejectedError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});

describe("TransactionSendError", () => {
  it("has correct _tag", () => {
    const error = new TransactionSendError({ message: "Send failed" });
    expect(error._tag).toBe("TransactionSendError");
  });

  it("stores message, optional cause and signature", () => {
    const cause = new Error("Network error");
    const error = new TransactionSendError({
      cause,
      message: "Send failed",
      signature: "abc123",
    });
    expect(error.message).toBe("Send failed");
    expect(error.cause).toBe(cause);
    expect(error.signature).toBe("abc123");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new TransactionSendError({ message: "test" })).pipe(
        Effect.catchTag("TransactionSendError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});

describe("TransactionFailedError", () => {
  it("has correct _tag", () => {
    const error = new TransactionFailedError({
      message: "Transaction failed",
      signature: "abc123",
    });
    expect(error._tag).toBe("TransactionFailedError");
  });

  it("stores signature, message, and optional logs", () => {
    const error = new TransactionFailedError({
      logs: ["log1", "log2"],
      message: "Transaction failed",
      signature: "abc123",
    });
    expect(error.signature).toBe("abc123");
    expect(error.message).toBe("Transaction failed");
    expect(error.logs).toEqual(["log1", "log2"]);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new TransactionFailedError({ message: "test", signature: "abc123" })
      ).pipe(Effect.catchTag("TransactionFailedError", (e) => Effect.succeed(e)));
      expect(caught.signature).toBe("abc123");
      expect(caught.message).toBe("test");
    })
  );
});

describe("TransactionTimeoutError", () => {
  it("has correct _tag", () => {
    const error = new TransactionTimeoutError({
      message: "Timeout",
      signature: "abc123",
    });
    expect(error._tag).toBe("TransactionTimeoutError");
  });

  it("stores signature and message", () => {
    const error = new TransactionTimeoutError({
      message: "Timeout waiting for confirmation",
      signature: "abc123",
    });
    expect(error.signature).toBe("abc123");
    expect(error.message).toBe("Timeout waiting for confirmation");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new TransactionTimeoutError({ message: "test", signature: "abc123" })
      ).pipe(Effect.catchTag("TransactionTimeoutError", (e) => Effect.succeed(e)));
      expect(caught.signature).toBe("abc123");
      expect(caught.message).toBe("test");
    })
  );
});

describe("BlockhashExpiredError", () => {
  it("has correct _tag", () => {
    const error = new BlockhashExpiredError({
      blockhash: "GH7ome3...",
      message: "Blockhash expired",
    });
    expect(error._tag).toBe("BlockhashExpiredError");
  });

  it("stores blockhash and message", () => {
    const error = new BlockhashExpiredError({
      blockhash: "GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC",
      message: "Blockhash expired",
    });
    expect(error.blockhash).toBe("GH7ome3EiwEr7tu9JuTh2dpYWBJK3z69Xm1ZE3MEE6JC");
    expect(error.message).toBe("Blockhash expired");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new BlockhashExpiredError({ blockhash: "abc123", message: "test" })
      ).pipe(Effect.catchTag("BlockhashExpiredError", (e) => Effect.succeed(e)));
      expect(caught.blockhash).toBe("abc123");
      expect(caught.message).toBe("test");
    })
  );
});

describe("SimulationFailedError", () => {
  it("has correct _tag", () => {
    const error = new SimulationFailedError({ message: "Simulation failed" });
    expect(error._tag).toBe("SimulationFailedError");
  });

  it("stores message, optional cause and logs", () => {
    const cause = new Error("Program error");
    const error = new SimulationFailedError({
      cause,
      logs: ["Program log: Error"],
      message: "Simulation failed",
    });
    expect(error.message).toBe("Simulation failed");
    expect(error.cause).toBe(cause);
    expect(error.logs).toEqual(["Program log: Error"]);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new SimulationFailedError({ message: "test" })).pipe(
        Effect.catchTag("SimulationFailedError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});

describe("WalletNotConnectedError", () => {
  it("has correct _tag", () => {
    const error = new WalletNotConnectedError({ message: "Wallet not connected" });
    expect(error._tag).toBe("WalletNotConnectedError");
  });

  it("stores message", () => {
    const error = new WalletNotConnectedError({ message: "Please connect your wallet" });
    expect(error.message).toBe("Please connect your wallet");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new WalletNotConnectedError({ message: "test" })).pipe(
        Effect.catchTag("WalletNotConnectedError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});

describe("SignatureError", () => {
  it("has correct _tag", () => {
    const error = new SignatureError({ message: "Signature failed" });
    expect(error._tag).toBe("SignatureError");
  });

  it("stores message and optional cause", () => {
    const cause = new Error("User rejected");
    const error = new SignatureError({ cause, message: "Signature failed" });
    expect(error.message).toBe("Signature failed");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new SignatureError({ message: "test" })).pipe(
        Effect.catchTag("SignatureError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});

// =============================================================================
// Program Errors
// =============================================================================

describe("InstructionNotFoundError", () => {
  it("has correct _tag", () => {
    const error = new InstructionNotFoundError({
      idlName: "spl-token",
      message: 'Instruction "transfer" not found in IDL "spl-token"',
      method: "transfer",
    });
    expect(error._tag).toBe("InstructionNotFoundError");
  });

  it("stores method and idlName", () => {
    const error = new InstructionNotFoundError({
      idlName: "spl-token",
      message: 'Instruction "transfer" not found in IDL "spl-token"',
      method: "transfer",
    });
    expect(error.method).toBe("transfer");
    expect(error.idlName).toBe("spl-token");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new InstructionNotFoundError({
          idlName: "my-program",
          message: 'Instruction "mint" not found in IDL "my-program"',
          method: "mint",
        })
      ).pipe(Effect.catchTag("InstructionNotFoundError", (e) => Effect.succeed(e)));
      expect(caught.method).toBe("mint");
      expect(caught.idlName).toBe("my-program");
    })
  );
});

describe("ProgramCreationError", () => {
  it("has correct _tag", () => {
    const error = new ProgramCreationError({
      cause: new Error("Invalid IDL"),
      message: "Failed to create Anchor program",
    });
    expect(error._tag).toBe("ProgramCreationError");
  });

  it("stores cause", () => {
    const cause = new Error("Invalid IDL");
    const error = new ProgramCreationError({
      cause,
      message: "Failed to create Anchor program",
    });
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ProgramCreationError({
          cause: null,
          message: "Failed to create Anchor program",
        })
      ).pipe(Effect.catchTag("ProgramCreationError", (e) => Effect.succeed(e)));
      expect(caught._tag).toBe("ProgramCreationError");
    })
  );
});

describe("InstructionBuildError", () => {
  it("has correct _tag", () => {
    const error = new InstructionBuildError({
      cause: new Error("Build failed"),
      message: 'Failed to build instruction "transfer"',
      method: "transfer",
    });
    expect(error._tag).toBe("InstructionBuildError");
  });

  it("stores method and cause", () => {
    const cause = new Error("Build failed");
    const error = new InstructionBuildError({
      cause,
      message: 'Failed to build instruction "transfer"',
      method: "transfer",
    });
    expect(error.method).toBe("transfer");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new InstructionBuildError({
          cause: null,
          message: 'Failed to build instruction "mint"',
          method: "mint",
        })
      ).pipe(Effect.catchTag("InstructionBuildError", (e) => Effect.succeed(e)));
      expect(caught.method).toBe("mint");
    })
  );
});

describe("ProgramReadError", () => {
  it("has correct _tag", () => {
    const error = new ProgramReadError({
      cause: new Error("View failed"),
      message: 'Failed to read "withdrawableAmountOf" via .view()',
      method: "withdrawableAmountOf",
    });
    expect(error._tag).toBe("ProgramReadError");
  });

  it("stores method and cause", () => {
    const cause = new Error("View failed");
    const error = new ProgramReadError({
      cause,
      message: 'Failed to read "withdrawableAmountOf" via .view()',
      method: "withdrawableAmountOf",
    });
    expect(error.method).toBe("withdrawableAmountOf");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ProgramReadError({
          cause: null,
          message: 'Failed to read "hasClaimed" via .view()',
          method: "hasClaimed",
        })
      ).pipe(Effect.catchTag("ProgramReadError", (e) => Effect.succeed(e)));
      expect(caught.method).toBe("hasClaimed");
    })
  );
});

describe("ViewNotSupportedError", () => {
  it("has correct _tag", () => {
    const error = new ViewNotSupportedError({
      idlName: "sablier-lockup",
      message: 'Method "withdraw" in IDL "sablier-lockup" does not support .view()',
      method: "withdraw",
    });
    expect(error._tag).toBe("ViewNotSupportedError");
  });

  it("stores method and idlName", () => {
    const error = new ViewNotSupportedError({
      idlName: "sablier-lockup",
      message: 'Method "withdraw" in IDL "sablier-lockup" does not support .view()',
      method: "withdraw",
    });
    expect(error.method).toBe("withdraw");
    expect(error.idlName).toBe("sablier-lockup");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ViewNotSupportedError({
          idlName: "sablier-lockup",
          message: 'Method "withdraw" in IDL "sablier-lockup" does not support .view()',
          method: "withdraw",
        })
      ).pipe(Effect.catchTag("ViewNotSupportedError", (e) => Effect.succeed(e)));
      expect(caught.idlName).toBe("sablier-lockup");
      expect(caught.method).toBe("withdraw");
    })
  );
});
