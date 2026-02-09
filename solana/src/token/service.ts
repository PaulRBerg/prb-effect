import type { Account, Address, Instruction } from "@solana/kit";
import { createNoopSigner } from "@solana/signers";
import type { Mint, Token as TokenAccountData } from "@solana-program/token";
import {
  fetchMaybeMint,
  fetchMaybeToken,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstructionAsync,
  getTransferInstruction,
} from "@solana-program/token";
import { Context, Effect, Layer } from "effect";
import { TOKEN_PROGRAM_ADDRESS } from "#src/constants/index.js";
import { AccountNotFoundError, RpcError } from "#src/core/errors/index.js";
import { RpcService } from "#src/rpc/index.js";
import { SpanNames } from "#src/telemetry/index.js";

export type MintAccount = Account<Mint>;
export type TokenAccount = Account<TokenAccountData>;

export type ATAParams = {
  readonly owner: Address;
  readonly mint: Address;
  readonly tokenProgram?: Address;
};

export type TokenServiceShape = {
  /**
   * Get the Associated Token Account address for an owner and mint.
   */
  readonly getAssociatedTokenAddress: (params: ATAParams) => Effect.Effect<Address, Error>;

  /**
   * Get or create an Associated Token Account.
   * Returns the address and optionally the instruction to create it.
   */
  readonly getOrCreateATA: (params: ATAParams & { payer: Address }) => Effect.Effect<
    {
      address: Address;
      instruction?: Instruction;
    },
    Error | RpcError
  >;

  /**
   * Get the token balance for an Associated Token Account.
   */
  readonly getTokenBalance: (
    ata: Address
  ) => Effect.Effect<bigint, AccountNotFoundError | RpcError>;

  /**
   * Get the mint account for a token.
   */
  readonly getMint: (mint: Address) => Effect.Effect<MintAccount, AccountNotFoundError | RpcError>;

  /**
   * Get a token account by address.
   */
  readonly getTokenAccount: (
    account: Address
  ) => Effect.Effect<TokenAccount, AccountNotFoundError | RpcError>;

  /**
   * Build a token transfer instruction.
   */
  readonly getTransferInstruction: (params: {
    readonly source: Address;
    readonly destination: Address;
    readonly authority: Address;
    readonly amount: bigint;
    readonly tokenProgram?: Address;
  }) => Effect.Effect<Instruction>;

  /**
   * Check if a token account exists.
   */
  readonly tokenAccountExists: (ata: Address) => Effect.Effect<boolean, RpcError>;
};

export class TokenService extends Context.Tag("esolana/TokenService")<
  TokenService,
  TokenServiceShape
>() {}

export const TokenServiceLive = Layer.effect(
  TokenService,
  Effect.gen(function* () {
    const rpcService = yield* RpcService;

    return TokenService.of({
      getAssociatedTokenAddress: (params) =>
        Effect.gen(function* () {
          const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
          const pda = yield* Effect.tryPromise({
            catch: (cause) =>
              new Error(`Failed to derive ATA for mint ${params.mint} and owner ${params.owner}`, {
                cause,
              }),
            try: () =>
              findAssociatedTokenPda({
                mint: params.mint,
                owner: params.owner,
                tokenProgram,
              }),
          });
          return pda[0];
        }).pipe(
          Effect.withSpan(SpanNames.TOKEN_GET_ATA, {
            attributes: {
              mint: params.mint,
              owner: params.owner,
            },
          })
        ),

      getMint: (mint) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const rpcUrl = yield* rpcService.getRpcUrl();

          const account = yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to fetch mint ${mint}`,
                url: rpcUrl,
              }),
            try: () => fetchMaybeMint(rpc, mint),
          });

          if (!account.exists) {
            return yield* Effect.fail(
              new AccountNotFoundError({
                address: mint,
                message: `Mint not found: ${mint}`,
              })
            );
          }

          return account;
        }).pipe(
          Effect.withSpan(SpanNames.TOKEN_GET_MINT, {
            attributes: { mint },
          })
        ),

      getOrCreateATA: (params) =>
        Effect.gen(function* () {
          const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
          const pda = yield* Effect.tryPromise({
            catch: (cause) =>
              new Error(`Failed to derive ATA for mint ${params.mint} and owner ${params.owner}`, {
                cause,
              }),
            try: () =>
              findAssociatedTokenPda({
                mint: params.mint,
                owner: params.owner,
                tokenProgram,
              }),
          });
          const ata = pda[0];

          const rpc = yield* rpcService.getRpc();
          const rpcUrl = yield* rpcService.getRpcUrl();

          // Check if account exists
          const accountInfo = yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to get account info for ${ata}`,
                url: rpcUrl,
              }),
            try: () => rpc.getAccountInfo(ata, { encoding: "base64" }).send(),
          });

          if (accountInfo.value) {
            // Account exists
            return { address: ata };
          }

          // Create instruction using idempotent version (safe to call even if exists)
          // Use NoopSigner since we only need the address for instruction creation
          // The actual signing happens later via TransactionService
          const payerSigner = createNoopSigner(params.payer);

          const instruction = yield* Effect.tryPromise({
            catch: (cause) =>
              new Error(
                `Failed to create ATA instruction for mint ${params.mint} and owner ${params.owner}`,
                { cause }
              ),
            try: () =>
              getCreateAssociatedTokenIdempotentInstructionAsync({
                ata,
                mint: params.mint,
                owner: params.owner,
                payer: payerSigner,
                tokenProgram,
              }),
          });

          return { address: ata, instruction };
        }).pipe(
          Effect.withSpan(SpanNames.TOKEN_CREATE_ATA, {
            attributes: {
              mint: params.mint,
              owner: params.owner,
            },
          })
        ),

      getTokenAccount: (accountAddress) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const rpcUrl = yield* rpcService.getRpcUrl();

          const account = yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to fetch token account ${accountAddress}`,
                url: rpcUrl,
              }),
            try: () => fetchMaybeToken(rpc, accountAddress),
          });

          if (!account.exists) {
            return yield* Effect.fail(
              new AccountNotFoundError({
                address: accountAddress,
                message: `Token account not found: ${accountAddress}`,
              })
            );
          }

          return account;
        }).pipe(
          Effect.withSpan(SpanNames.TOKEN_GET_ACCOUNT, {
            attributes: { account: accountAddress },
          })
        ),

      getTokenBalance: (ata) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const rpcUrl = yield* rpcService.getRpcUrl();
          const response = yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to get token balance for ${ata}`,
                url: rpcUrl,
              }),
            try: () => rpc.getTokenAccountBalance(ata).send(),
          });

          if (!response.value) {
            return yield* Effect.fail(
              new AccountNotFoundError({
                address: ata,
                message: `Token account not found: ${ata}`,
              })
            );
          }

          return BigInt(response.value.amount);
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_GET_TOKEN, {
            attributes: { ata },
          })
        ),

      getTransferInstruction: (params) =>
        Effect.sync(() => {
          const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;

          return getTransferInstruction(
            {
              amount: params.amount,
              authority: params.authority,
              destination: params.destination,
              source: params.source,
            },
            { programAddress: tokenProgram }
          );
        }).pipe(
          Effect.withSpan(SpanNames.TOKEN_TRANSFER, {
            attributes: {
              amount: params.amount.toString(),
              destination: params.destination,
              source: params.source,
            },
          })
        ),

      tokenAccountExists: (ata) =>
        Effect.gen(function* () {
          const rpc = yield* rpcService.getRpc();
          const rpcUrl = yield* rpcService.getRpcUrl();
          const response = yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to check token account ${ata}`,
                url: rpcUrl,
              }),
            try: () => rpc.getAccountInfo(ata, { encoding: "base64" }).send(),
          });
          return response.value !== null;
        }).pipe(
          Effect.withSpan(SpanNames.TOKEN_ACCOUNT_EXISTS, {
            attributes: { ata },
          })
        ),
    });
  })
);
