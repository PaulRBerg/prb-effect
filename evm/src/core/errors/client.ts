import { Schema } from "effect";

export class ClientNotFoundError extends Schema.TaggedError<ClientNotFoundError>()(
  "ClientNotFoundError",
  {
    chainId: Schema.Number,
    message: Schema.String,
  }
) {}

export class WalletNotConnectedError extends Schema.TaggedError<WalletNotConnectedError>()(
  "WalletNotConnectedError",
  {
    chainId: Schema.Number,
    message: Schema.String,
  }
) {}

export class WrongNetworkError extends Schema.TaggedError<WrongNetworkError>()(
  "WrongNetworkError",
  {
    actualChainId: Schema.Number,
    expectedChainId: Schema.Number,
    message: Schema.String,
  }
) {}

export class TransportError extends Schema.TaggedError<TransportError>()("TransportError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
  url: Schema.String,
}) {}
