import { describe, expect, it } from "vitest";

const REVERT_REASON_STRING_RE = /reverted with reason string ['"](.+)['"]/;
const REVERT_CUSTOM_ERROR_RE = /reverted with custom error ['"](.+)['"]/;
const EXECUTION_REVERTED_RE = /execution reverted(?::?\s*)(.+?)(?:\n|$)/i;

describe("viem error classification", () => {
  describe("isUserRejection", () => {
    const isUserRejection = (error: unknown): boolean => {
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        return (
          msg.includes("user rejected") ||
          msg.includes("user denied") ||
          msg.includes("rejected by user") ||
          msg.includes("user rejected request")
        );
      }
      return false;
    };

    it("detects user rejected request", () => {
      const error = new Error("User rejected the request");
      expect(isUserRejection(error)).toBe(true);
    });

    it("detects user denied transaction", () => {
      const error = new Error("User denied transaction signature");
      expect(isUserRejection(error)).toBe(true);
    });

    it("detects rejected by user message", () => {
      const error = new Error("Transaction was rejected by user");
      expect(isUserRejection(error)).toBe(true);
    });

    it("detects user rejected request with different case", () => {
      const error = new Error("USER REJECTED REQUEST");
      expect(isUserRejection(error)).toBe(true);
    });

    it("returns false for non-rejection errors", () => {
      const error = new Error("Network error");
      expect(isUserRejection(error)).toBe(false);
    });

    it("returns false for non-Error objects", () => {
      expect(isUserRejection("string error")).toBe(false);
      expect(isUserRejection(null)).toBe(false);
      expect(isUserRejection(undefined)).toBe(false);
      expect(isUserRejection({ message: "user rejected" })).toBe(false);
    });
  });

  describe("isInsufficientFunds", () => {
    const isInsufficientFunds = (error: unknown): boolean => {
      if (error instanceof Error) {
        const msg = error.message.toLowerCase();
        return (
          msg.includes("insufficient funds") ||
          msg.includes("insufficient balance") ||
          msg.includes("exceeds balance")
        );
      }
      return false;
    };

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

  describe("extractRevertReason", () => {
    const extractRevertReason = (error: unknown): string | undefined => {
      if (error instanceof Error) {
        // Try Viem's "execution reverted:" format first
        const execMatch = error.message.match(EXECUTION_REVERTED_RE);
        if (execMatch?.[1]) {
          return execMatch[1].trim();
        }

        // Try legacy formats
        const revertMatch = error.message.match(REVERT_REASON_STRING_RE);
        if (revertMatch) {
          return revertMatch[1];
        }

        const customErrorMatch = error.message.match(REVERT_CUSTOM_ERROR_RE);
        if (customErrorMatch) {
          return customErrorMatch[1];
        }

        if (error.message.includes("execution reverted")) {
          return "execution reverted";
        }
      }
      return;
    };

    it("extracts revert reason from error message", () => {
      const error = new Error("Transaction reverted with reason string 'Insufficient allowance'");
      const reason = extractRevertReason(error);
      expect(reason).toBe("Insufficient allowance");
    });

    it("extracts custom error name", () => {
      const error = new Error("Transaction reverted with custom error 'InsufficientBalance()'");
      const reason = extractRevertReason(error);
      expect(reason).toBe("InsufficientBalance()");
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
});
