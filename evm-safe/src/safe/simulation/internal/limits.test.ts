import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import type { Hex } from "viem";
import { TxSizeTooLargeError } from "../errors.js";
import { enforceTxSizeLimit } from "./limits/index.js";

const calldata = "0x1234" as Hex;

describe("enforceTxSizeLimit", () => {
  it.effect("passes when calldata fits the limit", () =>
    Effect.gen(function* () {
      const result = yield* enforceTxSizeLimit(calldata, 2);
      expect(result).toBeUndefined();
    })
  );

  it.effect("fails when calldata exceeds the limit", () =>
    Effect.gen(function* () {
      const error = yield* enforceTxSizeLimit(calldata, 1).pipe(Effect.flip);
      expect(error).toBeInstanceOf(TxSizeTooLargeError);
    })
  );
});
