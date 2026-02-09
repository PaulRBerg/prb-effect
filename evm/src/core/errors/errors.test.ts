import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { mainnet } from "viem/chains";
import { DEFAULT_MAX_DELAY } from "#src/constants/index.js";
import {
  ClientNotFoundError,
  ContractReadError,
  ContractWriteError,
  EventDecodeError,
  EventWatchError,
  GasEstimationError,
  MulticallError,
  ReceiptTimeoutError,
  SimulationFailedError,
  TransportError,
  TxFailedError,
  WalletNotConnectedError,
} from "#src/core/index.js";

describe("ClientNotFoundError", () => {
  it("has correct _tag", () => {
    const error = new ClientNotFoundError({
      chainId: mainnet.id,
      message: "Client not found",
    });
    expect(error._tag).toBe("ClientNotFoundError");
  });

  it("stores chainId and message", () => {
    const error = new ClientNotFoundError({
      chainId: mainnet.id,
      message: "Client not found",
    });
    expect(error.chainId).toBe(1);
    expect(error.message).toBe("Client not found");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ClientNotFoundError({ chainId: mainnet.id, message: "test" })
      ).pipe(Effect.catchTag("ClientNotFoundError", (e) => Effect.succeed(e)));
      expect(caught.chainId).toBe(1);
      expect(caught.message).toBe("test");
    })
  );
});

describe("WalletNotConnectedError", () => {
  it("has correct _tag", () => {
    const error = new WalletNotConnectedError({
      chainId: mainnet.id,
      message: "Wallet not connected",
    });
    expect(error._tag).toBe("WalletNotConnectedError");
  });

  it("stores chainId and message", () => {
    const error = new WalletNotConnectedError({
      chainId: mainnet.id,
      message: "Wallet not connected",
    });
    expect(error.chainId).toBe(1);
    expect(error.message).toBe("Wallet not connected");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new WalletNotConnectedError({ chainId: mainnet.id, message: "test" })
      ).pipe(Effect.catchTag("WalletNotConnectedError", (e) => Effect.succeed(e)));
      expect(caught.chainId).toBe(1);
      expect(caught.message).toBe("test");
    })
  );
});

describe("TransportError", () => {
  it("has correct _tag", () => {
    const error = new TransportError({
      message: "Transport failed",
      url: "https://example.com",
    });
    expect(error._tag).toBe("TransportError");
  });

  it("stores url, message, and optional cause", () => {
    const cause = new Error("Network error");
    const error = new TransportError({
      cause,
      message: "Transport failed",
      url: "https://example.com",
    });
    expect(error.url).toBe("https://example.com");
    expect(error.message).toBe("Transport failed");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new TransportError({ message: "test", url: "https://example.com" })
      ).pipe(Effect.catchTag("TransportError", (e) => Effect.succeed(e)));
      expect(caught.url).toBe("https://example.com");
      expect(caught.message).toBe("test");
    })
  );
});

describe("ContractReadError", () => {
  it("has correct _tag", () => {
    const error = new ContractReadError({
      address: "0x1234",
      functionName: "balanceOf",
      message: "Read failed",
    });
    expect(error._tag).toBe("ContractReadError");
  });

  it("stores address, functionName, message, and optional cause", () => {
    const cause = new Error("RPC error");
    const error = new ContractReadError({
      address: "0x1234",
      cause,
      functionName: "balanceOf",
      message: "Read failed",
    });
    expect(error.address).toBe("0x1234");
    expect(error.functionName).toBe("balanceOf");
    expect(error.message).toBe("Read failed");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ContractReadError({
          address: "0x1234",
          functionName: "balanceOf",
          message: "test",
        })
      ).pipe(Effect.catchTag("ContractReadError", (e) => Effect.succeed(e)));
      expect(caught.address).toBe("0x1234");
      expect(caught.functionName).toBe("balanceOf");
    })
  );
});

describe("SimulationFailedError", () => {
  it("has correct _tag", () => {
    const error = new SimulationFailedError({
      address: "0x1234",
      functionName: "transfer",
      message: "Simulation failed",
    });
    expect(error._tag).toBe("SimulationFailedError");
  });

  it("stores address, functionName, message, and optional revertData", () => {
    const error = new SimulationFailedError({
      address: "0x1234",
      functionName: "transfer",
      message: "Simulation failed",
      revertData: "0xabcd",
    });
    expect(error.address).toBe("0x1234");
    expect(error.functionName).toBe("transfer");
    expect(error.message).toBe("Simulation failed");
    expect(error.revertData).toBe("0xabcd");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new SimulationFailedError({
          address: "0x1234",
          functionName: "transfer",
          message: "test",
        })
      ).pipe(Effect.catchTag("SimulationFailedError", (e) => Effect.succeed(e)));
      expect(caught.address).toBe("0x1234");
      expect(caught.functionName).toBe("transfer");
    })
  );
});

describe("GasEstimationError", () => {
  it("has correct _tag", () => {
    const error = new GasEstimationError({
      address: "0x1234",
      functionName: "transfer",
      message: "Gas estimation failed",
    });
    expect(error._tag).toBe("GasEstimationError");
  });

  it("stores address, functionName, message, and optional cause", () => {
    const cause = new Error("Estimation error");
    const error = new GasEstimationError({
      address: "0x1234",
      cause,
      functionName: "transfer",
      message: "Gas estimation failed",
    });
    expect(error.address).toBe("0x1234");
    expect(error.functionName).toBe("transfer");
    expect(error.message).toBe("Gas estimation failed");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new GasEstimationError({
          address: "0x1234",
          functionName: "transfer",
          message: "test",
        })
      ).pipe(Effect.catchTag("GasEstimationError", (e) => Effect.succeed(e)));
      expect(caught.address).toBe("0x1234");
      expect(caught.functionName).toBe("transfer");
    })
  );
});

describe("ContractWriteError", () => {
  it("has correct _tag", () => {
    const error = new ContractWriteError({
      address: "0x1234",
      functionName: "transfer",
      message: "Write failed",
    });
    expect(error._tag).toBe("ContractWriteError");
  });

  it("stores address, functionName, message, and optional cause", () => {
    const cause = new Error("Write error");
    const error = new ContractWriteError({
      address: "0x1234",
      cause,
      functionName: "transfer",
      message: "Write failed",
    });
    expect(error.address).toBe("0x1234");
    expect(error.functionName).toBe("transfer");
    expect(error.message).toBe("Write failed");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ContractWriteError({
          address: "0x1234",
          functionName: "transfer",
          message: "test",
        })
      ).pipe(Effect.catchTag("ContractWriteError", (e) => Effect.succeed(e)));
      expect(caught.address).toBe("0x1234");
      expect(caught.functionName).toBe("transfer");
    })
  );
});

describe("MulticallError", () => {
  it("has correct _tag", () => {
    const error = new MulticallError({
      failedCalls: 3,
      message: "Multicall failed",
    });
    expect(error._tag).toBe("MulticallError");
  });

  it("stores failedCalls, message, and optional cause", () => {
    const cause = new Error("Multicall error");
    const error = new MulticallError({
      cause,
      failedCalls: 3,
      message: "Multicall failed",
    });
    expect(error.failedCalls).toBe(3);
    expect(error.message).toBe("Multicall failed");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new MulticallError({ failedCalls: 3, message: "test" })
      ).pipe(Effect.catchTag("MulticallError", (e) => Effect.succeed(e)));
      expect(caught.failedCalls).toBe(3);
      expect(caught.message).toBe("test");
    })
  );
});

describe("TxFailedError", () => {
  it("has correct _tag", () => {
    const error = new TxFailedError({
      hash: "0xabcd",
      message: "Transaction failed",
    });
    expect(error._tag).toBe("TxFailedError");
  });

  it("stores hash, message, and optional cause", () => {
    const cause = new Error("Transaction error");
    const error = new TxFailedError({
      cause,
      hash: "0xabcd",
      message: "Transaction failed",
    });
    expect(error.hash).toBe("0xabcd");
    expect(error.message).toBe("Transaction failed");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new TxFailedError({ hash: "0xabcd", message: "test" })
      ).pipe(Effect.catchTag("TxFailedError", (e) => Effect.succeed(e)));
      expect(caught.hash).toBe("0xabcd");
      expect(caught.message).toBe("test");
    })
  );
});

describe("ReceiptTimeoutError", () => {
  it("has correct _tag", () => {
    const error = new ReceiptTimeoutError({
      hash: "0xabcd",
      message: "Receipt timeout",
      timeout: DEFAULT_MAX_DELAY,
    });
    expect(error._tag).toBe("ReceiptTimeoutError");
  });

  it("stores hash, timeout, and message", () => {
    const error = new ReceiptTimeoutError({
      hash: "0xabcd",
      message: "Receipt timeout",
      timeout: DEFAULT_MAX_DELAY,
    });
    expect(error.hash).toBe("0xabcd");
    expect(error.timeout).toBe(DEFAULT_MAX_DELAY);
    expect(error.message).toBe("Receipt timeout");
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new ReceiptTimeoutError({
          hash: "0xabcd",
          message: "test",
          timeout: DEFAULT_MAX_DELAY,
        })
      ).pipe(Effect.catchTag("ReceiptTimeoutError", (e) => Effect.succeed(e)));
      expect(caught.hash).toBe("0xabcd");
      expect(caught.timeout).toBe(DEFAULT_MAX_DELAY);
    })
  );
});

describe("EventWatchError", () => {
  it("has correct _tag", () => {
    const error = new EventWatchError({
      chainId: mainnet.id,
      message: "Event watch failed",
    });
    expect(error._tag).toBe("EventWatchError");
  });

  it("stores chainId, message, and optional cause", () => {
    const cause = new Error("Watch error");
    const error = new EventWatchError({
      cause,
      chainId: mainnet.id,
      message: "Event watch failed",
    });
    expect(error.chainId).toBe(1);
    expect(error.message).toBe("Event watch failed");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(
        new EventWatchError({ chainId: mainnet.id, message: "test" })
      ).pipe(Effect.catchTag("EventWatchError", (e) => Effect.succeed(e)));
      expect(caught.chainId).toBe(1);
      expect(caught.message).toBe("test");
    })
  );
});

describe("EventDecodeError", () => {
  it("has correct _tag", () => {
    const error = new EventDecodeError({
      log: {},
      message: "Event decode failed",
    });
    expect(error._tag).toBe("EventDecodeError");
  });

  it("stores log, message, and optional cause", () => {
    const log = { address: "0x1234", topics: [] };
    const cause = new Error("Decode error");
    const error = new EventDecodeError({
      cause,
      log,
      message: "Event decode failed",
    });
    expect(error.log).toBe(log);
    expect(error.message).toBe("Event decode failed");
    expect(error.cause).toBe(cause);
  });

  it.effect("can be caught with catchTag", () =>
    Effect.gen(function* () {
      const caught = yield* Effect.fail(new EventDecodeError({ log: {}, message: "test" })).pipe(
        Effect.catchTag("EventDecodeError", (e) => Effect.succeed(e))
      );
      expect(caught.message).toBe("test");
    })
  );
});
