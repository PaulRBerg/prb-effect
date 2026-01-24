import { Schema } from "effect";

export class SignMessageError extends Schema.TaggedError<SignMessageError>()("SignMessageError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
}) {}

export class SignTypedDataError extends Schema.TaggedError<SignTypedDataError>()(
  "SignTypedDataError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
  }
) {}

export class SignTxError extends Schema.TaggedError<SignTxError>()("SignTxError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
}) {}

export class WalletConnectionError extends Schema.TaggedError<WalletConnectionError>()(
  "WalletConnectionError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
  }
) {}

export class ChainSwitchError extends Schema.TaggedError<ChainSwitchError>()("ChainSwitchError", {
  cause: Schema.optional(Schema.Unknown),
  chainId: Schema.Number,
  message: Schema.String,
}) {}

export class AddChainError extends Schema.TaggedError<AddChainError>()("AddChainError", {
  cause: Schema.optional(Schema.Unknown),
  chainId: Schema.Number,
  message: Schema.String,
}) {}

export class AccountNotConnectedError extends Schema.TaggedError<AccountNotConnectedError>()(
  "AccountNotConnectedError",
  {
    message: Schema.String,
  }
) {}

export class WatchAssetError extends Schema.TaggedError<WatchAssetError>()("WatchAssetError", {
  cause: Schema.optional(Schema.Unknown),
  message: Schema.String,
}) {}
