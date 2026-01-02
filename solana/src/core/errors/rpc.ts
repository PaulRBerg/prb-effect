import { Schema } from "effect";

export class RpcError extends Schema.TaggedError<RpcError>()("RpcError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
  url: Schema.String,
}) {}

export class ConnectionNotFoundError extends Schema.TaggedError<ConnectionNotFoundError>()(
  "ConnectionNotFoundError",
  {
    cluster: Schema.String,
    message: Schema.String,
  }
) {}
