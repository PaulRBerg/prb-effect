import { Schema } from "effect";

export class SubscriptionNotSupportedError extends Schema.TaggedError<SubscriptionNotSupportedError>()(
  "SubscriptionNotSupportedError",
  {
    chainId: Schema.Number,
    message: Schema.String,
    subscriptionType: Schema.String,
  }
) {}

export class SubscriptionDroppedError extends Schema.TaggedError<SubscriptionDroppedError>()(
  "SubscriptionDroppedError",
  {
    chainId: Schema.Number,
    message: Schema.String,
    subscriptionType: Schema.String,
  }
) {}
