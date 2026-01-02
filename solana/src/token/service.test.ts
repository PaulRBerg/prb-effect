import { describe, expect, it } from "@effect/vitest";
import { AccountState, getMintEncoder, getTokenEncoder } from "@solana-program/token";
import { Effect } from "effect";
import { TOKEN_2022_PROGRAM_ADDRESS, TOKEN_PROGRAM_ADDRESS } from "@/src/constants/index.js";
import {
  expectTaggedFailure,
  makeEffectSolanaTestLayer,
  makeMockRpc,
  TEST_ADDRESS,
  TEST_MINT,
  TEST_WALLET,
} from "@/src/testing-kit/index.js";
import { TokenService } from "@/src/token/index.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Solana RPC types use branded types that can't be constructed from literals
const makeRpcWithAccounts = (accounts: Record<string, Uint8Array | null>) =>
  makeMockRpc({
    getAccountInfo: ((address: string) => ({
      send: () => {
        const data = accounts[address] ?? null;
        if (!data) {
          return Promise.resolve({ context: { slot: 0n }, value: null });
        }

        const bytes = data;

        return Promise.resolve({
          context: { slot: 0n },
          value: {
            data: [Buffer.from(bytes).toString("base64"), "base64"],
            executable: false,
            lamports: 1n,
            owner: TOKEN_PROGRAM_ADDRESS,
            rentEpoch: 0n,
            space: BigInt(bytes.length),
          },
        });
      },
    })) as any,
  });

describe("TokenService (Live)", () => {
  it.effect("getMint returns decoded mint account", () => {
    const mintData = getMintEncoder().encode({
      decimals: 6,
      freezeAuthority: null,
      isInitialized: true,
      mintAuthority: null,
      supply: 1_000_000n,
    });

    const rpc = makeRpcWithAccounts({ [TEST_MINT]: mintData as Uint8Array });

    return Effect.gen(function* () {
      const service = yield* TokenService;
      const mint = yield* service.getMint(TEST_MINT);

      expect(mint.address).toBe(TEST_MINT);
      expect(mint.data.decimals).toBe(6);
      expect(mint.data.supply).toBe(1_000_000n);
    }).pipe(
      Effect.provide(
        makeEffectSolanaTestLayer({
          rpcService: { getRpc: () => Effect.succeed(rpc) },
        })
      )
    );
  });

  it.effect("getTokenAccount returns decoded token account", () => {
    const tokenData = getTokenEncoder().encode({
      amount: 42n,
      closeAuthority: null,
      delegate: null,
      delegatedAmount: 0n,
      isNative: null,
      mint: TEST_MINT,
      owner: TEST_WALLET,
      state: AccountState.Initialized,
    });

    const rpc = makeRpcWithAccounts({ [TEST_ADDRESS]: tokenData as Uint8Array });

    return Effect.gen(function* () {
      const service = yield* TokenService;
      const account = yield* service.getTokenAccount(TEST_ADDRESS);

      expect(account.address).toBe(TEST_ADDRESS);
      expect(account.data.amount).toBe(42n);
      expect(account.data.owner).toBe(TEST_WALLET);
    }).pipe(
      Effect.provide(
        makeEffectSolanaTestLayer({
          rpcService: { getRpc: () => Effect.succeed(rpc) },
        })
      )
    );
  });

  it.effect("getMint fails with AccountNotFoundError when account is missing", () => {
    const rpc = makeRpcWithAccounts({});

    return Effect.gen(function* () {
      const service = yield* TokenService;
      const exit = yield* Effect.exit(service.getMint(TEST_MINT));

      expectTaggedFailure(exit, "AccountNotFoundError");
    }).pipe(
      Effect.provide(
        makeEffectSolanaTestLayer({
          rpcService: { getRpc: () => Effect.succeed(rpc) },
        })
      )
    );
  });

  it.effect("getTransferInstruction respects token program override", () =>
    Effect.gen(function* () {
      const service = yield* TokenService;

      const defaultIx = yield* service.getTransferInstruction({
        amount: 1n,
        authority: TEST_WALLET,
        destination: TEST_ADDRESS,
        source: TEST_ADDRESS,
      });

      const token2022Ix = yield* service.getTransferInstruction({
        amount: 1n,
        authority: TEST_WALLET,
        destination: TEST_ADDRESS,
        source: TEST_ADDRESS,
        tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
      });

      expect(defaultIx.programAddress).toBe(TOKEN_PROGRAM_ADDRESS);
      expect(token2022Ix.programAddress).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    }).pipe(Effect.provide(makeEffectSolanaTestLayer()))
  );
});
