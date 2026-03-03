import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";
import { createActor, waitFor } from "xstate";
import type { TxMachineServices } from "./tx.js";

const { createTxMachine } = await import("./tx.js");

// =============================================================================
// Test Types
// =============================================================================

type TestPayload = {
  amount: number;
  isSafe: boolean;
};

type TestPreprocess = {
  validated: boolean;
  normalizedAmount: bigint;
};

type TestSignResult = {
  hash: string;
};

type TestResult = {
  hash: string | null;
  isQueued?: boolean;
  receipt?: { status: "success" };
};

type TestServices = TxMachineServices<TestPayload, TestPreprocess, TestSignResult, TestResult>;

// =============================================================================
// Mock Services Factory
// =============================================================================

function createMockServices(overrides: Partial<TestServices> = {}): TestServices {
  const base: TestServices = {
    onConfirm: vi.fn((_input: { payload: TestPayload; signResult: TestSignResult }) =>
      Effect.succeed({ hash: "0x123", receipt: { status: "success" } } satisfies TestResult)
    ) as TestServices["onConfirm"],
    onGasCheck: vi.fn((_input: { payload: TestPayload; preprocess: TestPreprocess }) =>
      Effect.succeed({ gasLimit: 100000n })
    ) as NonNullable<TestServices["onGasCheck"]>,
    onSign: vi.fn(
      (_input: { payload: TestPayload; preprocess: TestPreprocess; gasLimit?: bigint }) =>
        Effect.succeed({ hash: "0x123" } satisfies TestSignResult)
    ) as TestServices["onSign"],
    onSimulate: vi.fn((_input: { payload: TestPayload; preprocess: TestPreprocess }) =>
      Effect.succeed(undefined)
    ) as NonNullable<TestServices["onSimulate"]>,
    onValidate: vi.fn((_payload: TestPayload) =>
      Effect.succeed({ normalizedAmount: 100n, validated: true } satisfies TestPreprocess)
    ) as TestServices["onValidate"],
  };

  return { ...base, ...overrides } as TestServices;
}

// =============================================================================
// Test Helpers
// =============================================================================

function createTestMachine(options: {
  services?: TestServices;
  isUserRejectedError?: (error: unknown) => boolean;
  isGasLimitOverflowError?: (error: unknown) => ReturnType<typeof createOverflow> | undefined;
}) {
  const services = options.services ?? createMockServices();

  return createTxMachine<TestPayload, TestPreprocess, TestSignResult, TestResult>({
    getWalletType: (payload) => (payload.isSafe ? "safe" : "eoa"),
    id: "test",
    isGasLimitOverflowError: options.isGasLimitOverflowError,
    isUserRejectedError: options.isUserRejectedError,
    services,
  });
}

function createOverflow() {
  return {
    blockGasLimit: 30_000_000n,
    effectiveLimit: 25_000_000n,
    estimatedGas: 50_000_000n,
    reason: "exceeded" as const,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe("machines/tx", () => {
  // ---------------------------------------------------------------------------
  // 1. EOA wallet happy path
  // ---------------------------------------------------------------------------
  describe("EOA wallet happy path", () => {
    it("SUBMIT -> validate -> gasCheck -> signing -> pending -> success", async () => {
      const services = createMockServices();
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      // Initial state
      expect(actor.getSnapshot().value).toBe("initial");

      // Send SUBMIT with EOA payload
      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      // Wait for success
      const snapshot = await waitFor(actor, (s) => s.value === "success", { timeout: 2000 });

      // Verify services were called
      expect(services.onValidate).toHaveBeenCalledTimes(1);
      expect(services.onValidate).toHaveBeenCalledWith({ amount: 100, isSafe: false });

      expect(services.onGasCheck).toHaveBeenCalledTimes(1);
      expect(services.onGasCheck).toHaveBeenCalledWith({
        payload: { amount: 100, isSafe: false },
        preprocess: { normalizedAmount: 100n, validated: true },
      });

      // Simulate should NOT be called for EOA
      expect(services.onSimulate).not.toHaveBeenCalled();

      expect(services.onSign).toHaveBeenCalledTimes(1);
      expect(services.onSign).toHaveBeenCalledWith({
        gasLimit: 100000n,
        payload: { amount: 100, isSafe: false },
        preprocess: { normalizedAmount: 100n, validated: true },
      });

      expect(services.onConfirm).toHaveBeenCalledTimes(1);
      expect(services.onConfirm).toHaveBeenCalledWith({
        payload: { amount: 100, isSafe: false },
        signResult: { hash: "0x123" },
      });

      // Verify final context
      expect(snapshot.context.error).toBe(null);
      expect(snapshot.context.gasLimit).toBe(100000n);
      expect(snapshot.context.hash).toBe("0x123");
      expect(snapshot.context.signResult).toEqual({ hash: "0x123" });
      expect(snapshot.context.result).toEqual({ hash: "0x123", receipt: { status: "success" } });
    });

    it("allows gasCheck to return gasLimit undefined", async () => {
      const services = createMockServices({
        onGasCheck: vi.fn((_input: { payload: TestPayload; preprocess: TestPreprocess }) =>
          Effect.succeed({ gasLimit: undefined })
        ) as NonNullable<TestServices["onGasCheck"]>,
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "success", { timeout: 2000 });

      expect(services.onGasCheck).toHaveBeenCalledTimes(1);
      expect(services.onSign).toHaveBeenCalledWith({
        gasLimit: undefined,
        payload: { amount: 100, isSafe: false },
        preprocess: { normalizedAmount: 100n, validated: true },
      });
      expect(snapshot.context.gasLimit).toBe(undefined);
    });

    it("caches preprocess and gasLimit at each stage", async () => {
      const services = createMockServices();
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      // Wait for gasCheck to complete (signing state)
      await waitFor(actor, (s) => s.value === "signing", { timeout: 2000 });
      const signingSnapshot = actor.getSnapshot();
      expect(signingSnapshot.context.preprocess).toEqual({
        normalizedAmount: 100n,
        validated: true,
      });
      expect(signingSnapshot.context.gasLimit).toBe(100000n);

      // Wait for success
      const successSnapshot = await waitFor(actor, (s) => s.value === "success", { timeout: 2000 });
      expect(successSnapshot.context.signResult).toEqual({ hash: "0x123" });
      expect(successSnapshot.context.result).toEqual({
        hash: "0x123",
        receipt: { status: "success" },
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 2. Safe wallet happy path
  // ---------------------------------------------------------------------------
  describe("Safe wallet happy path", () => {
    it("SUBMIT -> validate -> simulate -> signing -> pending -> success", async () => {
      const services = createMockServices();
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      // Send SUBMIT with Safe payload
      actor.send({ payload: { amount: 200, isSafe: true }, type: "SUBMIT" });

      // Wait for success
      const snapshot = await waitFor(actor, (s) => s.value === "success", { timeout: 2000 });

      // Verify services were called in correct order
      expect(services.onValidate).toHaveBeenCalledTimes(1);
      expect(services.onValidate).toHaveBeenCalledWith({ amount: 200, isSafe: true });

      // For Safe, simulate should be called instead of gasCheck
      expect(services.onSimulate).toHaveBeenCalledTimes(1);
      expect(services.onSimulate).toHaveBeenCalledWith({
        payload: { amount: 200, isSafe: true },
        preprocess: { normalizedAmount: 100n, validated: true },
      });

      // gasCheck should NOT be called for Safe
      expect(services.onGasCheck).not.toHaveBeenCalled();

      expect(services.onSign).toHaveBeenCalledTimes(1);
      expect(services.onConfirm).toHaveBeenCalledTimes(1);

      // Verify final context
      expect(snapshot.context.error).toBe(null);
      expect(snapshot.context.hash).toBe("0x123");
      expect(snapshot.context.result).toEqual({ hash: "0x123", receipt: { status: "success" } });
    });

    it("promotes confirm hash over sign hash", async () => {
      const services = createMockServices({
        onConfirm: vi.fn((_input: { payload: TestPayload; signResult: TestSignResult }) =>
          Effect.succeed({
            hash: "0xonchain",
            receipt: { status: "success" },
          } satisfies TestResult)
        ),
        onSign: vi.fn(
          (_input: { payload: TestPayload; preprocess: TestPreprocess; gasLimit?: bigint }) =>
            Effect.succeed({ hash: "0xsafe" } satisfies TestSignResult)
        ),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 200, isSafe: true }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "success", { timeout: 2000 });

      expect(snapshot.context.signResult).toEqual({ hash: "0xsafe" });
      expect(snapshot.context.hash).toBe("0xonchain");
      expect(snapshot.context.result).toEqual({
        hash: "0xonchain",
        receipt: { status: "success" },
      });
    });

    it("clears sign hash when confirm returns hash null", async () => {
      const services = createMockServices({
        onConfirm: vi.fn((_input: { payload: TestPayload; signResult: TestSignResult }) =>
          Effect.succeed({ hash: null, isQueued: true } satisfies TestResult)
        ),
        onSign: vi.fn(
          (_input: { payload: TestPayload; preprocess: TestPreprocess; gasLimit?: bigint }) =>
            Effect.succeed({ hash: "0xsafe" } satisfies TestSignResult)
        ),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 200, isSafe: true }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "success", { timeout: 2000 });

      expect(snapshot.context.signResult).toEqual({ hash: "0xsafe" });
      expect(snapshot.context.hash).toBe(null);
      expect(snapshot.context.result).toEqual({ hash: null, isQueued: true });
    });

    it("branches correctly based on isSafe flag", async () => {
      const services = createMockServices();
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: true }, type: "SUBMIT" });

      // For Safe wallet, should go through simulate
      await waitFor(actor, (s) => s.value === "simulate", { timeout: 1000 });
      expect(actor.getSnapshot().value).toBe("simulate");

      // Wait for signing
      await waitFor(actor, (s) => s.value === "signing", { timeout: 1000 });

      // Confirm simulate was called
      expect(services.onSimulate).toHaveBeenCalled();
      expect(services.onGasCheck).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 3. Gas limit overflow from gasCheck (EOA)
  // ---------------------------------------------------------------------------
  describe("Gas limit overflow from gasCheck (EOA)", () => {
    it("transitions to gasLimitOverflow when onGasCheck returns overflow", async () => {
      const overflow = createOverflow();
      const services = createMockServices({
        onGasCheck: vi.fn(() => Effect.succeed({ overflow })),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "gasLimitOverflow", {
        timeout: 2000,
      });

      expect(snapshot.context.gasLimitOverflow).toEqual(overflow);
      expect(snapshot.context.error).toBe(null);
      expect(services.onSign).not.toHaveBeenCalled();
    });

    it("stores overflow details in context", async () => {
      const overflow = {
        blockGasLimit: 15_000_000n,
        effectiveLimit: 12_000_000n,
        estimatedGas: 20_000_000n,
        reason: "tx-cap" as const,
      };
      const services = createMockServices({
        onGasCheck: vi.fn(() => Effect.succeed({ overflow })),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "gasLimitOverflow", {
        timeout: 2000,
      });

      expect(snapshot.context.gasLimitOverflow?.blockGasLimit).toBe(15_000_000n);
      expect(snapshot.context.gasLimitOverflow?.effectiveLimit).toBe(12_000_000n);
      expect(snapshot.context.gasLimitOverflow?.estimatedGas).toBe(20_000_000n);
      expect(snapshot.context.gasLimitOverflow?.reason).toBe("tx-cap");
    });
  });

  // ---------------------------------------------------------------------------
  // 4. Gas limit overflow from simulate (Safe)
  // ---------------------------------------------------------------------------
  describe("Gas limit overflow from simulate (Safe)", () => {
    it("transitions to gasLimitOverflow when onSimulate returns overflow", async () => {
      const overflow = createOverflow();
      const services = createMockServices({
        onSimulate: vi.fn(() => Effect.succeed({ overflow })),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: true }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "gasLimitOverflow", {
        timeout: 2000,
      });

      expect(snapshot.context.gasLimitOverflow).toEqual(overflow);
      expect(snapshot.context.error).toBe(null);
      expect(services.onSign).not.toHaveBeenCalled();
    });

    it("Safe overflow is handled correctly without calling gasCheck", async () => {
      const overflow = createOverflow();
      const services = createMockServices({
        onSimulate: vi.fn(() => Effect.succeed({ overflow })),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: true }, type: "SUBMIT" });

      await waitFor(actor, (s) => s.value === "gasLimitOverflow", { timeout: 2000 });

      expect(services.onSimulate).toHaveBeenCalledTimes(1);
      expect(services.onGasCheck).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // 5. Gas limit overflow from error (using isGasLimitOverflowError)
  // ---------------------------------------------------------------------------
  describe("Gas limit overflow from error", () => {
    it("handles gas overflow error from gasCheck throw (EOA)", async () => {
      const overflow = createOverflow();
      const services = createMockServices({
        onGasCheck: vi.fn(() => Effect.fail(new Error("Gas limit exceeded"))),
      });
      const machine = createTxMachine<TestPayload, TestPreprocess, TestSignResult, TestResult>({
        getWalletType: (payload) => (payload.isSafe ? "safe" : "eoa"),
        id: "test-overflow-error",
        isGasLimitOverflowError: (error) => {
          if (error instanceof Error && error.message.includes("Gas limit exceeded")) {
            return overflow;
          }
          return undefined;
        },
        services,
      });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "gasLimitOverflow", {
        timeout: 2000,
      });

      expect(snapshot.context.gasLimitOverflow).toEqual(overflow);
      expect(snapshot.context.error).toBe(null);
    });

    it("handles gas overflow error from simulate throw (Safe)", async () => {
      const overflow = createOverflow();
      const services = createMockServices({
        onSimulate: vi.fn(() => Effect.fail(new Error("Simulation: gas exceeded block limit"))),
      });
      const machine = createTxMachine<TestPayload, TestPreprocess, TestSignResult, TestResult>({
        getWalletType: (payload) => (payload.isSafe ? "safe" : "eoa"),
        id: "test-overflow-error-safe",
        isGasLimitOverflowError: (error) => {
          if (error instanceof Error && error.message.includes("gas exceeded")) {
            return overflow;
          }
          return undefined;
        },
        services,
      });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: true }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "gasLimitOverflow", {
        timeout: 2000,
      });

      expect(snapshot.context.gasLimitOverflow).toEqual(overflow);
    });

    it("goes to failure if isGasLimitOverflowError returns undefined", async () => {
      const services = createMockServices({
        onGasCheck: vi.fn(() => Effect.fail(new Error("Network error"))),
      });
      const machine = createTxMachine<TestPayload, TestPreprocess, TestSignResult, TestResult>({
        getWalletType: (payload) => (payload.isSafe ? "safe" : "eoa"),
        id: "test-non-overflow-error",
        isGasLimitOverflowError: (error) => {
          // Only match gas limit errors, not network errors
          if (error instanceof Error && error.message.includes("Gas limit")) {
            return createOverflow();
          }
          return undefined;
        },
        services,
      });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(snapshot.context.error).toBe("Network error");
      expect(snapshot.context.errorMessage).toBe("Network error");
      expect(snapshot.context.gasLimitOverflow).toBe(null);
    });
  });

  // ---------------------------------------------------------------------------
  // 6. User rejection during signing
  // ---------------------------------------------------------------------------
  describe("User rejection during signing", () => {
    it("resets to initial state when user rejects transaction", async () => {
      const services = createMockServices({
        onSign: vi.fn(() => Effect.fail(new Error("User rejected the request"))),
      });
      const machine = createTxMachine<TestPayload, TestPreprocess, TestSignResult, TestResult>({
        getWalletType: (payload) => (payload.isSafe ? "safe" : "eoa"),
        id: "test-user-rejection",
        isUserRejectedError: (error) =>
          error instanceof Error && error.message.includes("User rejected"),
        services,
      });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "initial", { timeout: 2000 });

      // Context should be reset
      expect(snapshot.context.error).toBe(null);
      expect(snapshot.context.payload).toBe(null);
      expect(snapshot.context.preprocess).toBe(null);
      expect(snapshot.context.result).toBe(null);
    });

    it("goes to failure for non-user-rejection signing errors", async () => {
      const services = createMockServices({
        onSign: vi.fn(() => Effect.fail(new Error("Transaction underpriced"))),
      });
      const machine = createTxMachine<TestPayload, TestPreprocess, TestSignResult, TestResult>({
        getWalletType: (payload) => (payload.isSafe ? "safe" : "eoa"),
        id: "test-non-user-rejection",
        isUserRejectedError: (error) =>
          error instanceof Error && error.message.includes("User rejected"),
        services,
      });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(snapshot.context.error).toBe("Transaction underpriced");
      expect(snapshot.context.errorMessage).toBe("Transaction underpriced");
    });

    it("clears all context on user rejection", async () => {
      const services = createMockServices({
        onSign: vi.fn(() => Effect.fail(new Error("User denied transaction signature"))),
      });
      const machine = createTxMachine<TestPayload, TestPreprocess, TestSignResult, TestResult>({
        getWalletType: (payload) => (payload.isSafe ? "safe" : "eoa"),
        id: "test-clear-context",
        isUserRejectedError: (error) =>
          error instanceof Error && error.message.includes("User denied"),
        services,
      });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "initial", { timeout: 2000 });

      expect(snapshot.context).toEqual({
        error: null,
        errorMessage: null,
        gasLimit: undefined,
        gasLimitOverflow: null,
        hash: null,
        payload: null,
        preprocess: null,
        result: null,
        signResult: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 7. Validation failure
  // ---------------------------------------------------------------------------
  describe("Validation failure", () => {
    it("goes to failure state when onValidate throws", async () => {
      const services = createMockServices({
        onValidate: vi.fn(() => Effect.fail(new Error("Invalid amount: must be positive"))),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: -100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(snapshot.context.error).toBe("Invalid amount: must be positive");
      expect(snapshot.context.errorMessage).toBe("Invalid amount: must be positive");
      expect(services.onGasCheck).not.toHaveBeenCalled();
      expect(services.onSign).not.toHaveBeenCalled();
    });

    it("preserves tagged error details in context.error", async () => {
      const taggedError = {
        _tag: "ContractWriteError",
        address: "0xabc",
        calldata: "0xdeadbeef",
        cause: { reason: "execution reverted" },
        functionName: "createStream",
        message: "write reverted",
        sender: "0xdef",
      };
      const services = createMockServices({
        onValidate: vi.fn(() => Effect.fail(taggedError as unknown as Error)),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(snapshot.context.error).toEqual({
        details: {
          address: "0xabc",
          calldata: "0xdeadbeef",
          cause: { reason: "execution reverted" },
          functionName: "createStream",
          sender: "0xdef",
          tag: "ContractWriteError",
        },
        message: "write reverted",
      });
      expect(snapshot.context.errorMessage).toBe("write reverted");
    });

    it("exposes validation error message in context", async () => {
      const services = createMockServices({
        onValidate: vi.fn(() => Effect.fail(new Error("Recipient address is invalid"))),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(snapshot.context.error).toBe("Recipient address is invalid");
      expect(snapshot.context.errorMessage).toBe("Recipient address is invalid");
    });
  });

  // ---------------------------------------------------------------------------
  // 8. RESET from failure allows retry
  // ---------------------------------------------------------------------------
  describe("RESET from failure allows retry", () => {
    it("RESET transitions from failure to initial", async () => {
      const services = createMockServices({
        onValidate: vi.fn(() => Effect.fail(new Error("Validation failed"))),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });
      await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      // Send RESET
      actor.send({ type: "RESET" });

      const snapshot = await waitFor(actor, (s) => s.value === "initial", { timeout: 1000 });

      expect(snapshot.context.error).toBe(null);
      expect(snapshot.context.errorMessage).toBe(null);
      expect(snapshot.context.payload).toBe(null);
    });

    it("SUBMIT from failure triggers retry (goes to validate)", async () => {
      let callCount = 0;
      const services = createMockServices({
        onValidate: vi.fn(() => {
          callCount += 1;
          if (callCount === 1) {
            return Effect.fail(new Error("First attempt failed"));
          }
          return Effect.succeed({ normalizedAmount: 100n, validated: true });
        }),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      // First attempt fails
      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });
      await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(services.onValidate).toHaveBeenCalledTimes(1);

      // Retry from failure
      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "success", { timeout: 2000 });

      expect(services.onValidate).toHaveBeenCalledTimes(2);
      expect(snapshot.context.error).toBe(null);
      expect(snapshot.context.errorMessage).toBe(null);
      expect(snapshot.context.result).toEqual({ hash: "0x123", receipt: { status: "success" } });
    });

    it("clears error on RESET", async () => {
      const services = createMockServices({
        onValidate: vi.fn(() => Effect.fail(new Error("Some error"))),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });
      const failureSnapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(failureSnapshot.context.error).toBe("Some error");
      expect(failureSnapshot.context.errorMessage).toBe("Some error");

      actor.send({ type: "RESET" });
      const resetSnapshot = await waitFor(actor, (s) => s.value === "initial", { timeout: 1000 });

      expect(resetSnapshot.context.error).toBe(null);
      expect(resetSnapshot.context.errorMessage).toBe(null);
    });
  });

  // ---------------------------------------------------------------------------
  // 9. RESET from gasLimitOverflow
  // ---------------------------------------------------------------------------
  describe("RESET from gasLimitOverflow", () => {
    it("RESET transitions from gasLimitOverflow to initial", async () => {
      const overflow = createOverflow();
      const services = createMockServices({
        onGasCheck: vi.fn(() => Effect.succeed({ overflow })),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });
      await waitFor(actor, (s) => s.value === "gasLimitOverflow", { timeout: 2000 });

      // Send RESET
      actor.send({ type: "RESET" });

      const snapshot = await waitFor(actor, (s) => s.value === "initial", { timeout: 1000 });

      expect(snapshot.context.gasLimitOverflow).toBe(null);
      expect(snapshot.context.payload).toBe(null);
      expect(snapshot.context.preprocess).toBe(null);
    });

    it("clears all context on RESET from gasLimitOverflow", async () => {
      const overflow = createOverflow();
      const services = createMockServices({
        onGasCheck: vi.fn(() => Effect.succeed({ overflow })),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });
      const overflowSnapshot = await waitFor(actor, (s) => s.value === "gasLimitOverflow", {
        timeout: 2000,
      });

      expect(overflowSnapshot.context.gasLimitOverflow).not.toBe(null);
      expect(overflowSnapshot.context.payload).not.toBe(null);

      actor.send({ type: "RESET" });
      const resetSnapshot = await waitFor(actor, (s) => s.value === "initial", { timeout: 1000 });

      expect(resetSnapshot.context).toEqual({
        error: null,
        errorMessage: null,
        gasLimit: undefined,
        gasLimitOverflow: null,
        hash: null,
        payload: null,
        preprocess: null,
        result: null,
        signResult: null,
      });
    });
  });

  // ---------------------------------------------------------------------------
  // 10. Strict output schema validation
  // ---------------------------------------------------------------------------
  describe("Strict output schema validation", () => {
    it("fails when gasCheck output schema is invalid", async () => {
      const services = createMockServices({
        onGasCheck: vi.fn(() => Effect.succeed({ gasLimit: "100000" } as any)),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });
      expect(snapshot.context.errorMessage).toBe("Invalid gas check output schema");
      expect(services.onSign).not.toHaveBeenCalled();
    });

    it("fails when simulate output schema is invalid", async () => {
      const services = createMockServices({
        onSimulate: vi.fn(() =>
          Effect.succeed({
            overflow: {
              blockGasLimit: 30_000_000n,
              effectiveLimit: 25_000_000n,
              estimatedGas: 50_000_000n,
              reason: "invalid-reason",
            },
          } as any)
        ) as NonNullable<TestServices["onSimulate"]>,
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: true }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });
      expect(snapshot.context.errorMessage).toBe("Invalid simulate output schema");
      expect(services.onSign).not.toHaveBeenCalled();
    });

    it("fails when sign result has invalid hash type", async () => {
      const services = createMockServices({
        onSign: vi.fn(() => Effect.succeed({ hash: 123 } as any)),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });
      expect(snapshot.context.errorMessage).toBe("Invalid sign output schema");
    });

    it("fails when confirm result has invalid hash type", async () => {
      const services = createMockServices({
        onConfirm: vi.fn(() => Effect.succeed({ hash: 123 } as any)),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });
      expect(snapshot.context.errorMessage).toBe("Invalid confirm output schema");
    });
  });

  // ---------------------------------------------------------------------------
  // Additional edge cases
  // ---------------------------------------------------------------------------
  describe("Edge cases", () => {
    it("handles confirmation failure", async () => {
      const services = createMockServices({
        onConfirm: vi.fn(() => Effect.fail(new Error("Transaction reverted"))),
      });
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(snapshot.context.error).toBe("Transaction reverted");
      expect(snapshot.context.errorMessage).toBe("Transaction reverted");
      expect(snapshot.context.signResult).toEqual({ hash: "0x123" });
    });

    it("SUBMIT from success allows new transaction", async () => {
      const services = createMockServices();
      const machine = createTestMachine({ services });
      const actor = createActor(machine).start();

      // First successful transaction
      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });
      await waitFor(actor, (s) => s.value === "success", { timeout: 2000 });

      expect(services.onValidate).toHaveBeenCalledTimes(1);

      // Start new transaction from success
      actor.send({ payload: { amount: 200, isSafe: false }, type: "SUBMIT" });
      await waitFor(actor, (s) => s.value === "gasCheck", { timeout: 2000 });

      const inFlightSnapshot = actor.getSnapshot();
      expect(inFlightSnapshot.context.error).toBe(null);
      expect(inFlightSnapshot.context.result).toBe(null);
      expect(inFlightSnapshot.context.signResult).toBe(null);
      await waitFor(actor, (s) => s.value === "success", { timeout: 2000 });

      expect(services.onValidate).toHaveBeenCalledTimes(2);
      expect(services.onValidate).toHaveBeenLastCalledWith({ amount: 200, isSafe: false });
    });

    it("works without isUserRejectedError predicate", async () => {
      const services = createMockServices({
        onSign: vi.fn(() => Effect.fail(new Error("User rejected"))),
      });
      // No isUserRejectedError provided
      const machine = createTxMachine<TestPayload, TestPreprocess, TestSignResult, TestResult>({
        getWalletType: (payload) => (payload.isSafe ? "safe" : "eoa"),
        id: "test-no-user-rejection-handler",
        services,
      });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      // Without the predicate, all signing errors go to failure
      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(snapshot.context.error).toBe("User rejected");
      expect(snapshot.context.errorMessage).toBe("User rejected");
    });

    it("works without isGasLimitOverflowError predicate", async () => {
      const services = createMockServices({
        onGasCheck: vi.fn(() => Effect.fail(new Error("Gas limit exceeded"))),
      });
      // No isGasLimitOverflowError provided
      const machine = createTxMachine<TestPayload, TestPreprocess, TestSignResult, TestResult>({
        getWalletType: (payload) => (payload.isSafe ? "safe" : "eoa"),
        id: "test-no-overflow-handler",
        services,
      });
      const actor = createActor(machine).start();

      actor.send({ payload: { amount: 100, isSafe: false }, type: "SUBMIT" });

      // Without the predicate, gas errors go to failure
      const snapshot = await waitFor(actor, (s) => s.value === "failure", { timeout: 2000 });

      expect(snapshot.context.error).toBe("Gas limit exceeded");
      expect(snapshot.context.errorMessage).toBe("Gas limit exceeded");
    });
  });
});
