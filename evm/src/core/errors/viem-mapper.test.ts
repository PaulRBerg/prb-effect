import { describe, expect, it } from "vitest";
import { extractRevertReason, isInsufficientFunds, isUserRejection } from "./viem-mapper.js";

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

    it("returns false for non-Error objects", () => {
      expect(isUserRejection("string error")).toBe(false);
      expect(isUserRejection(null)).toBe(false);
      expect(isUserRejection(undefined)).toBe(false);
      expect(isUserRejection({ message: "user rejected" })).toBe(false);
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

  describe("extractRevertReason", () => {
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
