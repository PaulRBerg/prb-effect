import { describe, expect, it } from "@effect/vitest";
import { PublicKey } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Effect } from "effect";
import {
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "#src/constants/index.js";
import {
  expectTaggedFailure,
  makeEffectSolanaTestLayer,
  makeMockRpc,
  TEST_ADDRESS,
  TEST_MINT,
  TEST_WALLET,
} from "#src/testing-kit/index.js";
import { TokenService } from "#src/token/index.js";
import type { Address } from "#src/types/index.js";

type MockAccountData =
  | Uint8Array
  | {
      readonly data: Uint8Array;
      readonly owner?: Address;
    }
  | null;

const makeRpcWithAccounts = (accounts: Record<string, MockAccountData>) =>
  makeMockRpc({
    getAccountInfo: (address: PublicKey) => {
      const account = accounts[address.toBase58()] ?? null;
      if (!account) {
        return Promise.resolve(null);
      }

      const data = account instanceof Uint8Array ? account : account.data;
      const owner = account instanceof Uint8Array ? TOKEN_PROGRAM_ADDRESS : account.owner;

      return Promise.resolve({
        data: Buffer.from(data),
        executable: false,
        lamports: 1,
        owner: new PublicKey(owner ?? TOKEN_PROGRAM_ADDRESS),
        rentEpoch: 0,
      });
    },
  });

function writeOptionalPublicKey(
  buffer: Buffer,
  optionOffset: number,
  addressOffset: number,
  address: Address | null
): void {
  buffer.writeUInt32LE(address ? 1 : 0, optionOffset);
  if (address) {
    new PublicKey(address).toBuffer().copy(buffer, addressOffset);
  }
}

function encodeMint(params: {
  readonly decimals: number;
  readonly freezeAuthority: Address | null;
  readonly isInitialized: boolean;
  readonly mintAuthority: Address | null;
  readonly supply: bigint;
}): Buffer {
  const data = Buffer.alloc(82);
  writeOptionalPublicKey(data, 0, 4, params.mintAuthority);
  data.writeBigUInt64LE(params.supply, 36);
  data.writeUInt8(params.decimals, 44);
  data.writeUInt8(params.isInitialized ? 1 : 0, 45);
  writeOptionalPublicKey(data, 46, 50, params.freezeAuthority);
  return data;
}

function encodeTokenAccount(params: {
  readonly amount: bigint;
  readonly closeAuthority: Address | null;
  readonly delegate: Address | null;
  readonly delegatedAmount: bigint;
  readonly isNative: bigint | null;
  readonly mint: Address;
  readonly owner: Address;
  readonly state: number;
}): Buffer {
  const data = Buffer.alloc(165);
  new PublicKey(params.mint).toBuffer().copy(data, 0);
  new PublicKey(params.owner).toBuffer().copy(data, 32);
  data.writeBigUInt64LE(params.amount, 64);
  writeOptionalPublicKey(data, 72, 76, params.delegate);
  data.writeUInt8(params.state, 108);
  if (params.isNative === null) {
    data.writeUInt32LE(0, 109);
  } else {
    data.writeUInt32LE(1, 109);
    data.writeBigUInt64LE(params.isNative, 113);
  }
  data.writeBigUInt64LE(params.delegatedAmount, 121);
  writeOptionalPublicKey(data, 129, 133, params.closeAuthority);
  return data;
}

describe("TokenService (Live)", () => {
  it.effect("getMint returns decoded mint account", () => {
    const mintData = encodeMint({
      decimals: 6,
      freezeAuthority: null,
      isInitialized: true,
      mintAuthority: null,
      supply: 1_000_000n,
    });

    const rpc = makeRpcWithAccounts({ [TEST_MINT]: mintData });

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

  it.effect("getMint accepts Token-2022 mint accounts", () => {
    const mintData = encodeMint({
      decimals: 6,
      freezeAuthority: null,
      isInitialized: true,
      mintAuthority: null,
      supply: 1_000_000n,
    });

    const rpc = makeRpcWithAccounts({
      [TEST_MINT]: {
        data: mintData,
        owner: TOKEN_2022_PROGRAM_ADDRESS,
      },
    });

    return Effect.gen(function* () {
      const service = yield* TokenService;
      const mint = yield* service.getMint(TEST_MINT);

      expect(mint.programAddress).toBe(TOKEN_2022_PROGRAM_ADDRESS);
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
    const tokenData = encodeTokenAccount({
      amount: 42n,
      closeAuthority: null,
      delegate: null,
      delegatedAmount: 0n,
      isNative: null,
      mint: TEST_MINT,
      owner: TEST_WALLET,
      state: 1,
    });

    const rpc = makeRpcWithAccounts({ [TEST_ADDRESS]: tokenData });

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

  it.effect("getMint fails with RpcError when mint data cannot be decoded", () => {
    const rpc = makeRpcWithAccounts({ [TEST_MINT]: Buffer.alloc(1) });

    return Effect.gen(function* () {
      const service = yield* TokenService;
      const exit = yield* Effect.exit(service.getMint(TEST_MINT));

      expectTaggedFailure(exit, "RpcError");
    }).pipe(
      Effect.provide(
        makeEffectSolanaTestLayer({
          rpcService: { getRpc: () => Effect.succeed(rpc) },
        })
      )
    );
  });

  it.effect(
    "getTokenAccount fails with RpcError when account owner is not the token program",
    () => {
      const tokenData = encodeTokenAccount({
        amount: 42n,
        closeAuthority: null,
        delegate: null,
        delegatedAmount: 0n,
        isNative: null,
        mint: TEST_MINT,
        owner: TEST_WALLET,
        state: 1,
      });
      const rpc = makeRpcWithAccounts({
        [TEST_ADDRESS]: {
          data: tokenData,
          owner: SYSTEM_PROGRAM_ADDRESS,
        },
      });

      return Effect.gen(function* () {
        const service = yield* TokenService;
        const exit = yield* Effect.exit(service.getTokenAccount(TEST_ADDRESS));

        expectTaggedFailure(exit, "RpcError");
      }).pipe(
        Effect.provide(
          makeEffectSolanaTestLayer({
            rpcService: { getRpc: () => Effect.succeed(rpc) },
          })
        )
      );
    }
  );

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

      expect(defaultIx.programId.toBase58()).toBe(TOKEN_PROGRAM_ADDRESS);
      expect(token2022Ix.programId.toBase58()).toBe(TOKEN_2022_PROGRAM_ADDRESS);
    }).pipe(Effect.provide(makeEffectSolanaTestLayer()))
  );
});
