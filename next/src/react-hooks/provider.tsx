"use client";

import type * as ManagedRuntime from "effect/ManagedRuntime";
import type { ReactNode } from "react";
import { createContext, useContext } from "react";

/**
 * React context for the Effect runtime.
 *
 * Storage uses `ManagedRuntime<never, unknown>` for variance correctness:
 * - `never` (contravariant R): any runtime can be stored since all runtimes satisfy `never` requirements
 * - `unknown` (covariant E): stored runtime's errors widen safely to `unknown`
 *
 * The consumer-side cast in `useEffectNextRuntime` is safe because the actual
 * runtime passed to the provider must satisfy the consumer's requirements.
 *
 * @internal
 */
const EffectNextContext = createContext<ManagedRuntime.ManagedRuntime<never, unknown> | null>(null);

/**
 * Props for EffectNextProvider component.
 */
export type EffectNextProviderProps = {
  /** ManagedRuntime instance to provide to child components */
  readonly runtime: ManagedRuntime.ManagedRuntime<never, unknown>;
  /** Child components that can access the runtime */
  readonly children: ReactNode;
};

/**
 * Provider component that makes an Effect runtime available to all child components.
 * Place this at the root of your component tree (e.g., in app/layout.tsx).
 *
 * @example
 * ```tsx
 * // app/layout.tsx
 * import { ManagedRuntime } from "effect";
 * import { EffectNextProvider } from "effect-next/react-hooks";
 *
 * const runtime = ManagedRuntime.make(AppLayer);
 *
 * export default function RootLayout({ children }: { children: ReactNode }) {
 *   return (
 *     <html>
 *       <body>
 *         <EffectNextProvider runtime={runtime}>
 *           {children}
 *         </EffectNextProvider>
 *       </body>
 *     </html>
 *   );
 * }
 * ```
 */
export function EffectNextProvider({ runtime, children }: EffectNextProviderProps) {
  return <EffectNextContext.Provider value={runtime}>{children}</EffectNextContext.Provider>;
}

/**
 * Hook to access the Effect runtime from context.
 * Must be used within an EffectNextProvider.
 *
 * @throws Error if used outside of EffectNextProvider
 *
 * @example
 * ```tsx
 * "use client";
 *
 * import { useEffectNextRuntime } from "effect-next/react-hooks";
 * import { Effect } from "effect";
 *
 * function MyComponent() {
 *   const runtime = useEffectNextRuntime<MyServiceContext, never>();
 *
 *   const handleClick = () => {
 *     runtime.runPromise(
 *       Effect.gen(function* () {
 *         const service = yield* MyService;
 *         yield* service.doSomething();
 *       })
 *     );
 *   };
 *
 *   return <button onClick={handleClick}>Click me</button>;
 * }
 * ```
 */
export function useEffectNextRuntime<R = never, E = unknown>(): ManagedRuntime.ManagedRuntime<
  R,
  E
> {
  const runtime = useContext(EffectNextContext);
  if (!runtime) {
    throw new Error("useEffectNextRuntime must be used within EffectNextProvider");
  }
  return runtime as ManagedRuntime.ManagedRuntime<R, E>;
}

/**
 * Export context for advanced use cases.
 * @internal
 */
export { EffectNextContext };
