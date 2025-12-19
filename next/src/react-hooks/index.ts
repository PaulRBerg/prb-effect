/**
 * React hooks for Effect integration in Next.js applications.
 *
 * @module react-hooks
 */

export {
  useEffectMemo,
  useEffectOnce,
  useForkEffect,
  useStream,
  useStreamLatest,
  useSubscriptionRef,
} from "./primitives.js";

export {
  EffectNextProvider,
  type EffectNextProviderProps,
  useEffectNextRuntime,
} from "./provider.js";
