import { Schema } from "effect";

export class BlockNotFoundError extends Schema.TaggedError<BlockNotFoundError>()(
  "BlockNotFoundError",
  {
    blockIdentifier: Schema.String,
    chainId: Schema.Number,
    message: Schema.String,
  }
) {}

export class BlockTimeoutError extends Schema.TaggedError<BlockTimeoutError>()(
  "BlockTimeoutError",
  {
    blockNumber: Schema.BigIntFromSelf,
    chainId: Schema.Number,
    message: Schema.String,
    timeout: Schema.Number,
  }
) {}
