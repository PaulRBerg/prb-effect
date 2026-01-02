import { Schema } from "effect";

export class DeploymentError extends Schema.TaggedError<DeploymentError>()("DeploymentError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
}) {}

export class DeploymentRevertedError extends Schema.TaggedError<DeploymentRevertedError>()(
  "DeploymentRevertedError",
  {
    bytecode: Schema.String,
    message: Schema.String,
    revertData: Schema.optional(Schema.String),
  }
) {}

export class BytecodeMismatchError extends Schema.TaggedError<BytecodeMismatchError>()(
  "BytecodeMismatchError",
  {
    actual: Schema.String,
    address: Schema.String,
    expected: Schema.String,
    message: Schema.String,
  }
) {}
