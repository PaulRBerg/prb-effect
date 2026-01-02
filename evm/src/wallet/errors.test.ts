import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { mainnet } from "viem/chains";
import {
  AccountNotConnectedError,
  AddChainError,
  ChainSwitchError,
  SignMessageError,
  SignTransactionError,
  SignTypedDataError,
  WalletConnectionError,
} from "@/src/wallet/index.js";

describe("SignMessageError", () => {
  it("has correct _tag", () => {
    const error = new SignMessageError({ message: "Failed to sign message" });
    expect(error._tag).toBe("SignMessageError");
  });

  it("stores message without cause", () => {
    const error = new SignMessageError({ message: "Failed to sign message" });
    expect(error.message).toBe("Failed to sign message");
    expect(error.cause).toBeUndefined();
  });

  it("stores message with cause", () => {
    const cause = new Error("User rejected");
    const error = new SignMessageError({
      cause,
      message: "Failed to sign message",
    });
    expect(error.message).toBe("Failed to sign message");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new SignMessageError({ message: "test" })).pipe(
        Effect.catchTag("SignMessageError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});

describe("SignTypedDataError", () => {
  it("has correct _tag", () => {
    const error = new SignTypedDataError({
      message: "Failed to sign typed data",
    });
    expect(error._tag).toBe("SignTypedDataError");
  });

  it("stores message without cause", () => {
    const error = new SignTypedDataError({
      message: "Failed to sign typed data",
    });
    expect(error.message).toBe("Failed to sign typed data");
    expect(error.cause).toBeUndefined();
  });

  it("stores message with cause", () => {
    const cause = new Error("User rejected");
    const error = new SignTypedDataError({
      cause,
      message: "Failed to sign typed data",
    });
    expect(error.message).toBe("Failed to sign typed data");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new SignTypedDataError({ message: "test" })).pipe(
        Effect.catchTag("SignTypedDataError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});

describe("SignTransactionError", () => {
  it("has correct _tag", () => {
    const error = new SignTransactionError({
      message: "Failed to sign transaction",
    });
    expect(error._tag).toBe("SignTransactionError");
  });

  it("stores message without cause", () => {
    const error = new SignTransactionError({
      message: "Failed to sign transaction",
    });
    expect(error.message).toBe("Failed to sign transaction");
    expect(error.cause).toBeUndefined();
  });

  it("stores message with cause", () => {
    const cause = new Error("User rejected");
    const error = new SignTransactionError({
      cause,
      message: "Failed to sign transaction",
    });
    expect(error.message).toBe("Failed to sign transaction");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new SignTransactionError({ message: "test" })).pipe(
        Effect.catchTag("SignTransactionError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});

describe("WalletConnectionError", () => {
  it("has correct _tag", () => {
    const error = new WalletConnectionError({
      message: "Failed to connect wallet",
    });
    expect(error._tag).toBe("WalletConnectionError");
  });

  it("stores message without cause", () => {
    const error = new WalletConnectionError({
      message: "Failed to connect wallet",
    });
    expect(error.message).toBe("Failed to connect wallet");
    expect(error.cause).toBeUndefined();
  });

  it("stores message with cause", () => {
    const cause = new Error("User rejected");
    const error = new WalletConnectionError({
      cause,
      message: "Failed to connect wallet",
    });
    expect(error.message).toBe("Failed to connect wallet");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new WalletConnectionError({ message: "test" })).pipe(
        Effect.catchTag("WalletConnectionError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});

describe("ChainSwitchError", () => {
  it("has correct _tag", () => {
    const error = new ChainSwitchError({
      chainId: mainnet.id,
      message: "Failed to switch chain",
    });
    expect(error._tag).toBe("ChainSwitchError");
  });

  it("stores chainId and message without cause", () => {
    const error = new ChainSwitchError({
      chainId: mainnet.id,
      message: "Failed to switch chain",
    });
    expect(error.chainId).toBe(1);
    expect(error.message).toBe("Failed to switch chain");
    expect(error.cause).toBeUndefined();
  });

  it("stores chainId, message, and cause", () => {
    const cause = new Error("User rejected");
    const error = new ChainSwitchError({
      cause,
      chainId: mainnet.id,
      message: "Failed to switch chain",
    });
    expect(error.chainId).toBe(1);
    expect(error.message).toBe("Failed to switch chain");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ChainSwitchError({ chainId: mainnet.id, message: "test" })
      ).pipe(Effect.catchTag("ChainSwitchError", (e) => Effect.succeed(e)));
      expect(caught.chainId).toBe(1);
      expect(caught.message).toBe("test");
    })
  );
});

describe("AddChainError", () => {
  it("has correct _tag", () => {
    const error = new AddChainError({
      chainId: mainnet.id,
      message: "Failed to add chain",
    });
    expect(error._tag).toBe("AddChainError");
  });

  it("stores chainId and message without cause", () => {
    const error = new AddChainError({
      chainId: mainnet.id,
      message: "Failed to add chain",
    });
    expect(error.chainId).toBe(1);
    expect(error.message).toBe("Failed to add chain");
    expect(error.cause).toBeUndefined();
  });

  it("stores chainId, message, and cause", () => {
    const cause = new Error("User rejected");
    const error = new AddChainError({
      cause,
      chainId: mainnet.id,
      message: "Failed to add chain",
    });
    expect(error.chainId).toBe(1);
    expect(error.message).toBe("Failed to add chain");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new AddChainError({ chainId: mainnet.id, message: "test" })
      ).pipe(Effect.catchTag("AddChainError", (e) => Effect.succeed(e)));
      expect(caught.chainId).toBe(1);
      expect(caught.message).toBe("test");
    })
  );
});

describe("AccountNotConnectedError", () => {
  it("has correct _tag", () => {
    const error = new AccountNotConnectedError({
      message: "No account connected",
    });
    expect(error._tag).toBe("AccountNotConnectedError");
  });

  it("stores message", () => {
    const error = new AccountNotConnectedError({
      message: "No account connected",
    });
    expect(error.message).toBe("No account connected");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new AccountNotConnectedError({ message: "test" })).pipe(
        Effect.catchTag("AccountNotConnectedError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});
