import type { WalletProvider } from "#src/wallet/index.js";

export type MockWalletProviderConfig = {
  request?: (args: {
    method: string;
    params?: unknown[] | Record<string, unknown>;
  }) => Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

/**
 * Creates a mock WalletProvider for testing wallet connection flows
 */
export const makeMockWalletProvider = (config: MockWalletProviderConfig = {}): WalletProvider => ({
  on: config.on,
  removeListener: config.removeListener,
  request: config.request ?? (() => Promise.resolve(undefined)),
});
