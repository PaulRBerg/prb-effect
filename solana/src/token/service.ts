import type { AccountInfo } from "@solana/web3.js";
import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";
import { Buffer } from "buffer";
import { Context, Effect, Layer } from "effect";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "#src/constants/index.js";
import { AccountNotFoundError, RpcError } from "#src/core/errors/index.js";
import { RpcService } from "#src/rpc/index.js";
import { SpanNames } from "#src/telemetry/index.js";
import type { Address } from "#src/types/index.js";

type DecodedAccount<T> = {
  readonly address: Address;
  readonly data: T;
  readonly executable: boolean;
  readonly lamports: bigint;
  readonly programAddress: Address;
  readonly space: bigint;
};

export type Mint = {
  readonly decimals: number;
  readonly freezeAuthority: Address | null;
  readonly isInitialized: boolean;
  readonly mintAuthority: Address | null;
  readonly supply: bigint;
};

export type TokenAccountData = {
  readonly amount: bigint;
  readonly closeAuthority: Address | null;
  readonly delegate: Address | null;
  readonly delegatedAmount: bigint;
  readonly isNative: bigint | null;
  readonly mint: Address;
  readonly owner: Address;
  readonly state: TokenAccountState;
};

export type TokenAccountState = "uninitialized" | "initialized" | "frozen";

export type MintAccount = DecodedAccount<Mint>;
export type TokenAccount = DecodedAccount<TokenAccountData>;

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
      readonly address: Address;
      readonly instruction?: TransactionInstruction;
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
  }) => Effect.Effect<TransactionInstruction>;

  /**
   * Check if a token account exists.
   */
  readonly tokenAccountExists: (ata: Address) => Effect.Effect<boolean, RpcError>;
};

export class TokenService extends Context.Tag("esolana/TokenService")<
  TokenService,
  TokenServiceShape
>() {}

const MINT_SIZE = 82;
const TOKEN_ACCOUNT_SIZE = 165;

const publicKeyToAddress = (publicKey: PublicKey): Address => publicKey.toBase58() as Address;

const readOptionalPublicKey = (data: Buffer, optionOffset: number, addressOffset: number) => {
  const option = data.readUInt32LE(optionOffset);
  return option === 0
    ? null
    : publicKeyToAddress(new PublicKey(data.subarray(addressOffset, addressOffset + 32)));
};

const decodeMint = (data: Buffer): Mint => {
  if (data.length < MINT_SIZE) {
    throw new Error(`Invalid mint account data length: ${data.length}`);
  }

  return {
    decimals: data.readUInt8(44),
    freezeAuthority: readOptionalPublicKey(data, 46, 50),
    isInitialized: data.readUInt8(45) !== 0,
    mintAuthority: readOptionalPublicKey(data, 0, 4),
    supply: data.readBigUInt64LE(36),
  };
};

const decodeTokenState = (state: number): TokenAccountState => {
  switch (state) {
    case 0:
      return "uninitialized";
    case 1:
      return "initialized";
    case 2:
      return "frozen";
    default:
      throw new Error(`Invalid token account state: ${state}`);
  }
};

const decodeTokenAccount = (data: Buffer): TokenAccountData => {
  if (data.length < TOKEN_ACCOUNT_SIZE) {
    throw new Error(`Invalid token account data length: ${data.length}`);
  }

  const isNativeOption = data.readUInt32LE(109);

  return {
    amount: data.readBigUInt64LE(64),
    closeAuthority: readOptionalPublicKey(data, 129, 133),
    delegate: readOptionalPublicKey(data, 72, 76),
    delegatedAmount: data.readBigUInt64LE(121),
    isNative: isNativeOption === 0 ? null : data.readBigUInt64LE(113),
    mint: publicKeyToAddress(new PublicKey(data.subarray(0, 32))),
    owner: publicKeyToAddress(new PublicKey(data.subarray(32, 64))),
    state: decodeTokenState(data.readUInt8(108)),
  };
};

const TOKEN_ACCOUNT_OWNERS = new Set<Address>([TOKEN_PROGRAM_ADDRESS, TOKEN_2022_PROGRAM_ADDRESS]);

const assertTokenProgramOwner = (
  address: Address,
  accountInfo: AccountInfo<Buffer>,
  accountKind: string
): void => {
  const owner = publicKeyToAddress(accountInfo.owner);
  if (!TOKEN_ACCOUNT_OWNERS.has(owner)) {
    throw new Error(
      `${accountKind} ${address} is owned by ${owner}, expected ${TOKEN_PROGRAM_ADDRESS} or ${TOKEN_2022_PROGRAM_ADDRESS}`
    );
  }
};

const makeDecodedAccount = <T>(
  address: Address,
  accountInfo: AccountInfo<Buffer>,
  data: T
): DecodedAccount<T> => ({
  address,
  data,
  executable: accountInfo.executable,
  lamports: BigInt(accountInfo.lamports),
  programAddress: publicKeyToAddress(accountInfo.owner),
  space: BigInt(accountInfo.data.length),
});

const decodeTokenProgramAccount = <T>(params: {
  readonly accountInfo: AccountInfo<Buffer>;
  readonly address: Address;
  readonly decode: (data: Buffer) => T;
  readonly kind: string;
  readonly rpcUrl: string;
}): Effect.Effect<DecodedAccount<T>, RpcError> =>
  Effect.try({
    catch: (cause) =>
      new RpcError({
        cause,
        message: `Failed to decode ${params.kind} ${params.address}`,
        url: params.rpcUrl,
      }),
    try: () => {
      assertTokenProgramOwner(params.address, params.accountInfo, params.kind);
      return makeDecodedAccount(
        params.address,
        params.accountInfo,
        params.decode(params.accountInfo.data)
      );
    },
  });

const findAssociatedTokenAddress = (params: Required<ATAParams>): Address => {
  const [address] = PublicKey.findProgramAddressSync(
    [
      new PublicKey(params.owner).toBuffer(),
      new PublicKey(params.tokenProgram).toBuffer(),
      new PublicKey(params.mint).toBuffer(),
    ],
    new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS)
  );

  return publicKeyToAddress(address);
};

const deriveAssociatedTokenAddress = (params: ATAParams): Effect.Effect<Address, Error> => {
  const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
  return Effect.try({
    catch: (cause) =>
      new Error(`Failed to derive ATA for mint ${params.mint} and owner ${params.owner}`, {
        cause,
      }),
    try: () =>
      findAssociatedTokenAddress({
        mint: params.mint,
        owner: params.owner,
        tokenProgram,
      }),
  });
};

const getCreateAssociatedTokenIdempotentInstruction = (params: {
  readonly ata: Address;
  readonly mint: Address;
  readonly owner: Address;
  readonly payer: Address;
  readonly tokenProgram: Address;
}): TransactionInstruction =>
  new TransactionInstruction({
    data: Buffer.from([1]),
    programId: new PublicKey(ASSOCIATED_TOKEN_PROGRAM_ADDRESS),
    keys: [
      { isSigner: true, isWritable: true, pubkey: new PublicKey(params.payer) },
      { isSigner: false, isWritable: true, pubkey: new PublicKey(params.ata) },
      { isSigner: false, isWritable: false, pubkey: new PublicKey(params.owner) },
      { isSigner: false, isWritable: false, pubkey: new PublicKey(params.mint) },
      { isSigner: false, isWritable: false, pubkey: SystemProgram.programId },
      { isSigner: false, isWritable: false, pubkey: new PublicKey(params.tokenProgram) },
    ],
  });

const getTokenTransferInstruction = (params: {
  readonly source: Address;
  readonly destination: Address;
  readonly authority: Address;
  readonly amount: bigint;
  readonly tokenProgram: Address;
}): TransactionInstruction => {
  const data = Buffer.alloc(9);
  data.writeUInt8(3, 0);
  data.writeBigUInt64LE(params.amount, 1);

  return new TransactionInstruction({
    data,
    programId: new PublicKey(params.tokenProgram),
    keys: [
      { isSigner: false, isWritable: true, pubkey: new PublicKey(params.source) },
      { isSigner: false, isWritable: true, pubkey: new PublicKey(params.destination) },
      { isSigner: true, isWritable: false, pubkey: new PublicKey(params.authority) },
    ],
  });
};

export const TokenServiceLive = Layer.effect(
  TokenService,
  Effect.gen(function* () {
    const rpcService = yield* RpcService;

    return TokenService.of({
      getAssociatedTokenAddress: (params) =>
        Effect.gen(function* () {
          return yield* deriveAssociatedTokenAddress(params);
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

          const accountInfo = yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to fetch mint ${mint}`,
                url: rpcUrl,
              }),
            try: () => rpc.getAccountInfo(new PublicKey(mint)),
          });

          if (!accountInfo) {
            return yield* Effect.fail(
              new AccountNotFoundError({
                address: mint,
                message: `Mint not found: ${mint}`,
              })
            );
          }

          return yield* decodeTokenProgramAccount({
            accountInfo,
            address: mint,
            decode: decodeMint,
            kind: "mint account",
            rpcUrl,
          });
        }).pipe(
          Effect.withSpan(SpanNames.TOKEN_GET_MINT, {
            attributes: { mint },
          })
        ),

      getOrCreateATA: (params) =>
        Effect.gen(function* () {
          const tokenProgram = params.tokenProgram ?? TOKEN_PROGRAM_ADDRESS;
          const ata = yield* deriveAssociatedTokenAddress(params);

          const rpc = yield* rpcService.getRpc();
          const rpcUrl = yield* rpcService.getRpcUrl();

          const accountInfo = yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to get account info for ${ata}`,
                url: rpcUrl,
              }),
            try: () => rpc.getAccountInfo(new PublicKey(ata)),
          });

          if (accountInfo) {
            return { address: ata };
          }

          return {
            address: ata,
            instruction: getCreateAssociatedTokenIdempotentInstruction({
              ata,
              mint: params.mint,
              owner: params.owner,
              payer: params.payer,
              tokenProgram,
            }),
          };
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

          const accountInfo = yield* Effect.tryPromise({
            catch: (cause) =>
              new RpcError({
                cause,
                message: `Failed to fetch token account ${accountAddress}`,
                url: rpcUrl,
              }),
            try: () => rpc.getAccountInfo(new PublicKey(accountAddress)),
          });

          if (!accountInfo) {
            return yield* Effect.fail(
              new AccountNotFoundError({
                address: accountAddress,
                message: `Token account not found: ${accountAddress}`,
              })
            );
          }

          return yield* decodeTokenProgramAccount({
            accountInfo,
            address: accountAddress,
            decode: decodeTokenAccount,
            kind: "token account",
            rpcUrl,
          });
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
            try: () => rpc.getTokenAccountBalance(new PublicKey(ata)),
          });

          return BigInt(response.value.amount);
        }).pipe(
          Effect.withSpan(SpanNames.BALANCE_GET_TOKEN, {
            attributes: { ata },
          })
        ),

      getTransferInstruction: (params) =>
        Effect.sync(() =>
          getTokenTransferInstruction({
            ...params,
            tokenProgram: params.tokenProgram ?? TOKEN_PROGRAM_ADDRESS,
          })
        ).pipe(
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
            try: () => rpc.getAccountInfo(new PublicKey(ata)),
          });
          return response !== null;
        }).pipe(
          Effect.withSpan(SpanNames.TOKEN_ACCOUNT_EXISTS, {
            attributes: { ata },
          })
        ),
    });
  })
);
