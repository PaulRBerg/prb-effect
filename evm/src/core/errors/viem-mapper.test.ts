import { BaseError, UnknownRpcError } from "viem";
import { describe, expect, it } from "vitest";
import { ContractWriteError } from "./contract.js";
import { TransactionSubmissionError } from "./tx.js";
import {
  classifyContractError,
  classifyGasEstimationError,
  classifyWriteError,
  extractRevertReason,
  isInsufficientFunds,
  isNonceTooLowError,
  isResourceExhaustion,
  isUserRejection,
} from "./viem-mapper.js";

const TEST_VALUE = "1000000000000000000";
const WRITE_CONTEXT = {
  address: "0x1234567890123456789012345678901234567890",
  functionName: "withdraw",
  value: TEST_VALUE,
} as const;

describe("viem error classification", () => {
  describe("isUserRejection", () => {
    it("detects user rejected request by code", () => {
      const error = Object.assign(new Error("User rejected the request"), { code: 4001 });
      expect(isUserRejection(error)).toBe(true);
    });

    it("detects user rejected request by name", () => {
      const error = new Error("User denied transaction signature");
      error.name = "UserRejectedRequestError";
      expect(isUserRejection(error)).toBe(true);
    });

    it("detects EIP-1193 rejection code", () => {
      expect(isUserRejection({ code: 4001, message: "User rejected the request" })).toBe(true);
    });

    it("detects rejection in nested cause", () => {
      const cause = Object.assign(new Error("User denied transaction signature"), { code: 4001 });
      const error = new Error("outer", { cause });
      expect(isUserRejection(error)).toBe(true);
    });

    it("returns false for non-rejection errors", () => {
      const error = new Error("Network error");
      expect(isUserRejection(error)).toBe(false);
    });

    it("returns false for non-Error objects without rejection indicators", () => {
      expect(isUserRejection("string error")).toBe(false);
      expect(isUserRejection(null)).toBe(false);
      expect(isUserRejection(undefined)).toBe(false);
      // Plain objects with rejection message are now detected (lenient matching)
      expect(isUserRejection({ message: "user rejected" })).toBe(true);
      // But objects without rejection indicators return false
      expect(isUserRejection({ message: "network error" })).toBe(false);
    });
  });

  describe("isInsufficientFunds", () => {
    it("detects insufficient funds from error message", () => {
      const error = new Error("insufficient funds for gas");
      expect(isInsufficientFunds(error)).toBe(true);
    });

    it("detects insufficient balance", () => {
      const error = new Error("Insufficient balance for transfer");
      expect(isInsufficientFunds(error)).toBe(true);
    });

    it("detects exceeds balance message", () => {
      const error = new Error("Amount exceeds balance");
      expect(isInsufficientFunds(error)).toBe(true);
    });

    it("returns false for other errors", () => {
      const error = new Error("Transaction reverted");
      expect(isInsufficientFunds(error)).toBe(false);
    });
  });

  describe("isNonceTooLowError", () => {
    it("detects nonce too low from a plain Error", () => {
      expect(isNonceTooLowError(new Error("nonce too low"))).toBe(true);
    });

    it("detects nonce too low under ContractWriteError cause", () => {
      const error = new ContractWriteError({
        address: "0x1234567890123456789012345678901234567890",
        cause: new Error("nonce has already been used"),
        functionName: "transfer",
        message: "Failed to write transfer",
      });

      expect(isNonceTooLowError(error)).toBe(true);
    });

    it("detects nonce too low from viem details", () => {
      const error = new BaseError("RPC request failed", {
        details: "already used nonce",
      });

      expect(isNonceTooLowError(error)).toBe(true);
    });

    it("detects common client and wallet nonce-low message formats", () => {
      const messages = [
        "Nonce too low",
        "nonce too low: address 0x0000000000000000000000000000000000000000, tx: 2 state: 3",
        "nonce too low: address 0x0000000000000000000000000000000000000000 current nonce (7) > tx nonce (6)",
        "Nonce too low. Expected nonce to be 1 but got 0.",
        "Transaction nonce is too low",
      ];

      for (const message of messages) {
        expect(isNonceTooLowError(new Error(message))).toBe(true);
      }
    });

    it("returns false for non nonce-low transaction pool errors", () => {
      const messages = [
        "replacement transaction underpriced",
        "transaction underpriced",
        "already known",
        "account nonce too high? expected 7 got 9",
      ];

      for (const message of messages) {
        expect(isNonceTooLowError(new Error(message))).toBe(false);
      }
    });
  });

  describe("isResourceExhaustion", () => {
    it("detects 'Cannot allocate memory' from plain Error", () => {
      const error = new Error(
        "Failed to send transaction. The operation couldn't be completed. Cannot allocate memory"
      );
      expect(isResourceExhaustion(error)).toBe(true);
    });

    it("detects ENOMEM from plain Error", () => {
      const error = new Error("ENOMEM: not enough memory");
      expect(isResourceExhaustion(error)).toBe(true);
    });

    it("detects 'out of memory' from plain Error", () => {
      const error = new Error("JavaScript heap out of memory");
      expect(isResourceExhaustion(error)).toBe(true);
    });

    it("detects memory error buried in viem cause chain", () => {
      const innerError = new Error("Cannot allocate memory");
      // Simulate viem's UnknownRpcError wrapping the OS-level error
      const viemError = new UnknownRpcError(innerError);
      expect(isResourceExhaustion(viemError)).toBe(true);
    });

    it("detects from string", () => {
      expect(isResourceExhaustion("Cannot allocate memory")).toBe(true);
    });

    it("returns false for unrelated errors", () => {
      expect(isResourceExhaustion(new Error("Transaction reverted"))).toBe(false);
      expect(isResourceExhaustion(new Error("insufficient funds"))).toBe(false);
      expect(isResourceExhaustion(null)).toBe(false);
      expect(isResourceExhaustion(undefined)).toBe(false);
    });
  });

  describe("extractRevertReason", () => {
    it("extracts revert reason from error message", () => {
      const error = new Error("Transaction reverted with reason string 'Insufficient allowance'");
      const reason = extractRevertReason(error);
      expect(reason).toBe("Insufficient allowance");
    });

    it("extracts custom error name", () => {
      const error = new Error("Transaction reverted with custom error 'InsufficientBalance()'");
      const reason = extractRevertReason(error);
      expect(reason).toBe("InsufficientBalance");
    });

    it("detects generic execution reverted", () => {
      const error = new Error("Transaction execution reverted");
      const reason = extractRevertReason(error);
      expect(reason).toBe("execution reverted");
    });

    it("returns undefined for non-revert errors", () => {
      const error = new Error("Network timeout");
      const reason = extractRevertReason(error);
      expect(reason).toBeUndefined();
    });

    it("returns undefined for non-Error objects", () => {
      expect(extractRevertReason("string error")).toBeUndefined();
      expect(extractRevertReason(null)).toBeUndefined();
      expect(extractRevertReason({ message: "reverted" })).toBeUndefined();
    });

    it("extracts reason from Viem execution reverted format", () => {
      const error = new Error("execution reverted: ERC20: transfer amount exceeds allowance");
      const reason = extractRevertReason(error);
      expect(reason).toBe("ERC20: transfer amount exceeds allowance");
    });

    it("extracts custom error from Viem format", () => {
      const error = new Error("execution reverted: SablierLockup_DepositAmountZero");
      const reason = extractRevertReason(error);
      expect(reason).toBe("SablierLockup_DepositAmountZero");
    });
  });

  describe("classifyContractError", () => {
    it("returns SimulationFailedError with structured execution payload", () => {
      const error = classifyContractError(
        new Error("execution reverted: ERC20: transfer amount exceeds allowance"),
        {
          address: "0x1234567890123456789012345678901234567890",
          functionName: "transfer",
          value: TEST_VALUE,
        }
      );

      expect(error._tag).toBe("SimulationFailedError");
      if (error._tag === "SimulationFailedError") {
        expect(error.phase).toBe("simulate");
        expect(error.revertReason).toBe("ERC20: transfer amount exceeds allowance");
        expect(error.customErrorName).toBeUndefined();
        expect(error.value).toBe(TEST_VALUE);
      }
    });

    it("returns ContractReadError for non-execution failures", () => {
      const error = classifyContractError(new Error("Network timeout"), {
        address: "0x1234567890123456789012345678901234567890",
        functionName: "transfer",
      });

      expect(error._tag).toBe("ContractReadError");
    });
  });

  describe("classifyGasEstimationError", () => {
    it("returns GasEstimationError with structured execution payload", () => {
      const error = classifyGasEstimationError(
        new Error("execution reverted: SablierLockup_DepositAmountZero"),
        {
          address: "0x1234567890123456789012345678901234567890",
          functionName: "withdraw",
          value: TEST_VALUE,
        }
      );

      expect(error._tag).toBe("GasEstimationError");
      if (error._tag === "GasEstimationError") {
        expect(error.phase).toBe("estimate");
        expect(error.customErrorName).toBe("SablierLockup_DepositAmountZero");
        expect(error.value).toBe(TEST_VALUE);
      }
    });
  });

  describe("classifyWriteError", () => {
    it("returns ContractWriteError with decimal-string value", () => {
      const error = classifyWriteError(new Error("RPC failed"), WRITE_CONTEXT);

      expect(error._tag).toBe("ContractWriteError");
      if (error._tag === "ContractWriteError") {
        expect(error.value).toBe(TEST_VALUE);
      }
    });

    it("classifies the incident as TransactionSubmissionError", () => {
      const providerError = new Error(
        "RPC 0x8f Custom eth_sendRawTransaction: Transaction decoding error"
      );
      const error = classifyWriteError(providerError, WRITE_CONTEXT);

      expect(error).toBeInstanceOf(TransactionSubmissionError);
      if (error._tag === "TransactionSubmissionError") {
        expect(error.reason).toBe("raw-transaction-decoding");
        expect(error.cause).toBe(providerError);
      }
    });

    it("matches method and decoding details across nested provider fields", () => {
      const providerError = {
        shortMessage: "Request ETH_SENDRAWTRANSACTION failed",
        cause: {
          details: "TRANSACTION DECODING ERROR",
        },
      };
      const error = classifyWriteError(providerError, WRITE_CONTEXT);

      expect(error._tag).toBe("TransactionSubmissionError");
    });

    it("matches a viem BaseError cause chain", () => {
      const providerError = new BaseError("Raw transaction submission failed", {
        cause: new BaseError("Provider rejected the payload", {
          details: "Transaction decoding error",
        }),
        metaMessages: ["Method: eth_sendRawTransaction"],
      });
      const error = classifyWriteError(providerError, WRITE_CONTEXT);

      expect(error._tag).toBe("TransactionSubmissionError");
    });

    it("tolerates cyclic provider error objects", () => {
      const providerError: Record<string, unknown> = {
        details: "Transaction decoding error",
        message: "eth_sendRawTransaction failed",
      };
      providerError.cause = providerError;

      const classify = () => classifyWriteError(providerError, WRITE_CONTEXT);
      expect(classify).not.toThrow();
      expect(classify()._tag).toBe("TransactionSubmissionError");
    });

    it("does not classify decoding language without eth_sendRawTransaction", () => {
      const error = classifyWriteError(
        new Error("Transaction decoding error while processing a response"),
        WRITE_CONTEXT
      );

      expect(error._tag).toBe("ContractWriteError");
    });

    it("does not classify unrelated eth_sendRawTransaction failures", () => {
      const error = classifyWriteError(
        new Error("eth_sendRawTransaction: replacement transaction underpriced"),
        WRITE_CONTEXT
      );

      expect(error._tag).toBe("ContractWriteError");
    });

    it.each([
      "eth_sendRawTransaction: execution reverted; failed to decode revert data",
      "Failed to decode contract function result",
    ])("keeps contract/revert decoding failure generic: %s", (message) => {
      const error = classifyWriteError(new Error(message), WRITE_CONTEXT);
      expect(error._tag).toBe("ContractWriteError");
    });

    it.each([
      {
        expectedTag: "UserRejectedError",
        message: "User rejected eth_sendRawTransaction: Transaction decoding error",
      },
      {
        expectedTag: "InsufficientFundsError",
        message: "Insufficient funds; eth_sendRawTransaction: Transaction decoding error",
      },
      {
        expectedTag: "ResourceExhaustionError",
        message: "Cannot allocate memory; eth_sendRawTransaction: Transaction decoding error",
      },
    ] as const)("preserves $expectedTag precedence", ({ expectedTag, message }) => {
      const error = classifyWriteError(new Error(message), WRITE_CONTEXT);
      expect(error._tag).toBe(expectedTag);
    });
  });
});
