# Code Review: `feat/evm-retry`

## Summary

This branch adds retry logic for receipt polling by creating a new internal module and exporting `isRetryableError` from
the RPC module. The implementation is clean overall, but there are critical build failures and the new retry schedule is
not integrated into the transaction manager.

---

## Critical (Must fix before merge)

### 1. Build failure - incorrect error type names

`evm/src/tx/internal/receipt-retry.ts:4-6`

```typescript
import type {
  ReceiptTimeoutError,
  TransactionFailedError, // Does not exist
  TransactionReplacedError, // Does not exist
} from "@/src/core/index.js";
```

The actual error types are `TxFailedError` and `TxReplacedError`. This causes a build failure.

**Fix:**

```typescript
import type { ReceiptTimeoutError, TxFailedError, TxReplacedError } from "@/src/core/index.js";
```

And update the `whileInput` type parameter:

```typescript
Schedule.whileInput<TxFailedError | ReceiptTimeoutError | TxReplacedError>(
```

### 2. Test file uses wrong error type

`evm/src/tx/receipt-retry.test.ts:5`

```typescript
import { TransactionFailedError } from "@/src/core/index.js";
```

Should be:

```typescript
import { TxFailedError } from "@/src/core/index.js";
```

And update all test usages (`TransactionFailedError` -> `TxFailedError`).

---

## High Priority (Should fix)

### 3. Unused import in manager.ts

`evm/src/tx/manager.ts:2`

```typescript
import { Clock, Context, Duration, Effect, Fiber, Layer, Ref, Stream } from "effect";
```

`Duration` was added but is not used anywhere in the file. This suggests the retry schedule integration was intended but
not completed.

### 4. Receipt retry schedule is created but never used

The `makeReceiptRetrySchedule()` function in `receipt-retry.ts` is exported, but there's no integration with
`TxManager.waitForReceipt`. The `waitForReceipt` method still uses `Effect.tryPromise` without any retry logic.

Was the intent to wrap `waitForReceipt` with this retry schedule? If so, it needs to be integrated. If this is
intentional groundwork for a future PR, consider adding a TODO comment or noting it in the commit message.

### 5. Test schedule differs from production schedule

`evm/src/tx/receipt-retry.test.ts:16-23`

```typescript
const makeTestRetrySchedule = () =>
  makeBackoffSchedule({ baseDelay: 1, jitter: false, maxRetries: 3 }).pipe(
    Schedule.whileInput<TransactionFailedError>((error) => {
      if (error._tag === "TransactionFailedError" && error.cause) {
        return isRetryableError(error.cause, receiptRetryablePatterns);
      }
      return false;
    }),
  );
```

The production schedule uses `baseDelay: 1000` but the test uses `baseDelay: 1`. While the logic being tested is the
`whileInput` predicate (which is consistent), consider:

1. The test `whileInput` type only handles `TransactionFailedError`, but production handles the union
   `TxFailedError | ReceiptTimeoutError | TxReplacedError`
2. The test checks for `_tag === "TransactionFailedError"` which will never match since the actual tag is
   `"TxFailedError"`

This means **all tests currently pass for the wrong reason** - the predicate returns `false` because the tag check
fails, but the tests expect retries based on the error cause patterns.

---

## Suggestions (Consider improving)

### 6. Export the receipt retry module

The module is in `internal/` but may need to be exported for external use. If consumers should use this schedule, add an
export from `evm/src/tx/index.ts`.

### 7. Consider merging patterns into `defaultRetryableErrors`

`evm/src/tx/internal/receipt-retry.ts:14-18`

```typescript
export const receiptRetryablePatterns = [
  ...defaultRetryableErrors,
  "transaction not found",
  "receipt not found",
  "could not find transaction",
];
```

These receipt-specific patterns are reasonable additions. However, consider whether they should be part of the default
patterns in `rpc/retry.ts` since "transaction not found" could occur in other RPC contexts (e.g., `getTransaction`).

### 8. Version bump appears correct

`beta.7` -> `beta.8` is appropriate for new functionality.

---

## Good Practices Observed

- **Clean separation**: New retry logic is isolated in its own module under `internal/`
- **Pattern reuse**: Extends existing `defaultRetryableErrors` and reuses `makeBackoffSchedule`
- **Comprehensive tests**: Test file covers success paths, various error patterns, non-retryable errors, and retry
  exhaustion
- **Specific patterns**: The receipt patterns are intentionally specific (`"transaction not found"` vs `"not found"`) to
  avoid false positives
