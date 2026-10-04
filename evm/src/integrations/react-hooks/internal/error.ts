import * as Cause from "effect/Cause";
import * as Option from "effect/Option";

export type EffectError<E> = E | Cause.Cause<never>;

export const fromCause = <E>(cause: Cause.Cause<E>): EffectError<E> => {
  const failure = Cause.findErrorOption(cause);
  return Option.isSome(failure) ? failure.value : (cause as Cause.Cause<never>);
};

export const fromUnknown = (cause: unknown): Cause.Cause<never> =>
  Cause.isCause(cause) ? (cause as Cause.Cause<never>) : Cause.die(cause);
