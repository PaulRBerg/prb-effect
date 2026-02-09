import type { Address, Instruction } from "@solana/kit";
import type { Layer } from "effect";
import { Effect } from "effect";
import type { AccountNotFoundError, RpcError } from "#src/core/errors/index.js";
import type { ATAParams, MintAccount, TokenAccount } from "#src/token/index.js";
import { TokenService } from "#src/token/index.js";
import { TEST_ADDRESS_2 } from "./_fixtures/addresses.js";
import { makeMockServiceLayer } from "./helpers.js";

/**
 * Configuration for the mock TokenService
 *
 * All methods are optional - sensible defaults are provided.
 * Override specific methods to customize mock behavior for your tests.
 */
export type MockTokenServiceConfig = {
  getAssociatedTokenAddress?: (params: ATAParams) => Effect.Effect<Address>;
  getOrCreateATA?: (params: ATAParams & { payer: Address }) => Effect.Effect<
    {
      address: Address;
      instruction?: Instruction;
    },
    RpcError
  >;
  getTokenBalance?: (ata: Address) => Effect.Effect<bigint, AccountNotFoundError | RpcError>;
  getMint?: (mint: Address) => Effect.Effect<MintAccount, AccountNotFoundError | RpcError>;
  getTokenAccount?: (
    account: Address
  ) => Effect.Effect<TokenAccount, AccountNotFoundError | RpcError>;
  getTransferInstruction?: (params: {
    readonly source: Address;
    readonly destination: Address;
    readonly authority: Address;
    readonly amount: bigint;
    readonly tokenProgram?: Address;
  }) => Effect.Effect<Instruction>;
  tokenAccountExists?: (ata: Address) => Effect.Effect<boolean, RpcError>;
};

const defaultConfig: Required<MockTokenServiceConfig> = {
  getAssociatedTokenAddress: () => Effect.succeed(TEST_ADDRESS_2),
  getMint: () =>
    Effect.succeed({
      address: TEST_ADDRESS_2,
      data: {
        decimals: 0,
        freezeAuthority: { __option: "None" },
        isInitialized: true,
        mintAuthority: { __option: "None" },
        supply: 0n,
      },
      executable: false,
      lamports: 0n,
      programAddress: TEST_ADDRESS_2,
      space: 0n,
    } as MintAccount),
  getOrCreateATA: () =>
    Effect.succeed({
      address: TEST_ADDRESS_2,
      instruction: undefined, // Account already exists
    }),
  getTokenAccount: () =>
    Effect.succeed({
      address: TEST_ADDRESS_2,
      data: {
        amount: 0n,
        closeAuthority: { __option: "None" },
        delegate: { __option: "None" },
        delegatedAmount: 0n,
        isNative: { __option: "None" },
        mint: TEST_ADDRESS_2,
        owner: TEST_ADDRESS_2,
        state: 1,
      },
      executable: false,
      lamports: 0n,
      programAddress: TEST_ADDRESS_2,
      space: 0n,
    } as TokenAccount),
  getTokenBalance: () => Effect.succeed(1000000000n), // 1 token with 9 decimals
  getTransferInstruction: () =>
    Effect.succeed({
      accounts: [],
      data: new Uint8Array(),
      programAddress: TEST_ADDRESS_2,
    } as Instruction),
  tokenAccountExists: () => Effect.succeed(true),
};

/**
 * Creates a mock TokenService layer for testing
 *
 * @param config - Optional configuration to override default mock behaviors
 *
 * @example
 * ```typescript
 * // Basic usage with defaults
 * const layer = makeMockTokenServiceLayer();
 *
 * // Override specific methods
 * const layer = makeMockTokenServiceLayer({
 *   getTokenBalance: () => Effect.succeed(5000000000n),
 *   tokenAccountExists: () => Effect.succeed(false),
 * });
 *
 * // Use in tests
 * Effect.gen(function* () {
 *   const tokenService = yield* TokenService;
 *   const balance = yield* tokenService.getTokenBalance(ata);
 * }).pipe(
 *   Effect.provide(layer)
 * );
 * ```
 */
export const makeMockTokenServiceLayer = (
  config: MockTokenServiceConfig = {}
): Layer.Layer<TokenService> =>
  makeMockServiceLayer(TokenService, defaultConfig, config, (merged) => merged);
