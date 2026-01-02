import { Schema } from "effect";

export class EventDecodeError extends Schema.TaggedError<EventDecodeError>()("EventDecodeError", {
  cause: Schema.optional(Schema.Unknown),
  log: Schema.Unknown,
  message: Schema.String,
}) {}

export class EventWatchError extends Schema.TaggedError<EventWatchError>()("EventWatchError", {
  cause: Schema.optional(Schema.Unknown),
  chainId: Schema.Number,
  message: Schema.String,
}) {}
