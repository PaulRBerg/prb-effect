import { Schema } from "effect";

export class EnsNameNotFoundError extends Schema.TaggedError<EnsNameNotFoundError>()(
  "EnsNameNotFoundError",
  {
    message: Schema.String,
    name: Schema.String,
  }
) {}

export class EnsReverseNameNotFoundError extends Schema.TaggedError<EnsReverseNameNotFoundError>()(
  "EnsReverseNameNotFoundError",
  {
    address: Schema.String,
    message: Schema.String,
  }
) {}

export class EnsTextNotFoundError extends Schema.TaggedError<EnsTextNotFoundError>()(
  "EnsTextNotFoundError",
  {
    key: Schema.String,
    message: Schema.String,
    name: Schema.String,
  }
) {}

export class EnsAvatarNotFoundError extends Schema.TaggedError<EnsAvatarNotFoundError>()(
  "EnsAvatarNotFoundError",
  {
    message: Schema.String,
    name: Schema.String,
  }
) {}

export class EnsResolverNotConfiguredError extends Schema.TaggedError<EnsResolverNotConfiguredError>()(
  "EnsResolverNotConfiguredError",
  {
    message: Schema.String,
    name: Schema.String,
  }
) {}

export class EnsResolutionError extends Schema.TaggedError<EnsResolutionError>()(
  "EnsResolutionError",
  {
    cause: Schema.optional(Schema.Unknown),
    message: Schema.String,
    name: Schema.String,
  }
) {}
