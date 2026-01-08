# @prb/effect-solana

Effect-TS integration for the Solana blockchain ecosystem.

## Installation

```bash
npm install @prb/effect-solana effect @solana/kit
# or
pnpm add @prb/effect-solana effect @solana/kit
# or
bun add @prb/effect-solana effect @solana/kit
```

## Quick Start

```typescript
import { Effect, Layer } from "effect";
import { BalanceService, BalanceServiceLive, RpcService, RpcServiceLive } from "@prb/effect-solana";
import type { Address } from "@solana/kit";

// Create a custom RPC layer
const MyRpcLayer = Layer.succeed(RpcService, {
  getRpc: () => Effect.succeed(/* your RPC client */),
  getRpcUrl: () => Effect.succeed("https://api.devnet.solana.com"),
});

// Compose with BalanceService
const MainLayer = BalanceServiceLive.pipe(Layer.provide(MyRpcLayer));

// Read SOL balance
const program = Effect.gen(function* () {
  const balance = yield* BalanceService;
  const address = "YOUR_ADDRESS" as Address;
  const sol = yield* balance.getSolBalance(address);
  console.log(`Balance: ${sol} lamports`);
});

Effect.runPromise(Effect.provide(program, MainLayer));
```

## Services

### RpcService

Manages Solana RPC client per cluster.

```typescript
import { RpcService } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const rpcService = yield* RpcService;
  const rpc = yield* rpcService.getRpc();
  const url = yield* rpcService.getRpcUrl();
});
```

### SignerService

Wallet signing interface (adapter-agnostic).

```typescript
import { SignerService } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const signer = yield* SignerService;
  const address = yield* signer.getAddress();
  const signed = yield* signer.signTransaction(tx);
});
```

### BalanceService

SOL balance queries and monitoring.

```typescript
import { BalanceService } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const balance = yield* BalanceService;

  // Get balance
  const sol = yield* balance.getSolBalance(address);

  // Check sufficient balance
  const hasFunds = yield* balance.hasSufficientBalance({
    address,
    required: 1_000_000_000n,
  });

  // Watch balance changes
  const stream = yield* balance.watchBalance({
    address,
    pollingInterval: 5000,
  });
});
```

### TokenService

SPL token operations.

```typescript
import { TokenService } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const token = yield* TokenService;

  // Get associated token address
  const ata = yield* token.getAssociatedTokenAddress({ owner, mint });

  // Token-2022: pass tokenProgram to work with Token-2022 mints
  const ata2022 = yield* token.getAssociatedTokenAddress({
    owner,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  // Get or create ATA
  const { address, instruction } = yield* token.getOrCreateATA({ owner, mint, payer });

  // Get token balance
  const balance = yield* token.getTokenBalance(ata);

  // Get mint account
  const mint = yield* token.getMint(params.mint);

  // Get token account
  const account = yield* token.getTokenAccount(ata);

  // Build transfer instruction
  const transfer = yield* token.getTransferInstruction({
    source: ata,
    destination: recipientAta,
    authority: owner,
    amount: 1_000_000n,
  });

  const transfer2022 = yield* token.getTransferInstruction({
    source: ata2022,
    destination: recipientAta2022,
    authority: owner,
    amount: 1_000_000n,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  // Check if token account exists
  const exists = yield* token.tokenAccountExists(ata);
});
```

### TransactionService

Transaction lifecycle management.

```typescript
import { TransactionService } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const tx = yield* TransactionService;

  // Build transaction
  const message = yield* tx.build(instructions, {
    computeBudget: { unitLimit: 600_000, microLamports: 10_000 },
  });

  // Sign transaction
  const signed = yield* tx.sign(message);

  // Send transaction
  const signature = yield* tx.send(signed);

  // Confirm transaction
  const receipt = yield* tx.confirm(signature, {
    commitment: "confirmed",
    timeout: 60_000,
  });

  // Or do all at once
  const receipt2 = yield* tx.sendAndConfirm(instructions, {
    commitment: "confirmed",
  });

  // Batch send and confirm
  const receipts = yield* tx.sendAndConfirmBatch(
    [{ instructions }, { instructions: [instruction2], computeBudget: { unitLimit: 300_000 } }],
    { concurrency: 2, confirm: { commitment: "confirmed" } },
  );

  // Simulate before sending
  yield* tx.simulate(message);
});
```

### ProgramWriter

Build instructions from Anchor IDLs (Solana equivalent of EVM's ContractWriter).

```typescript
import { ProgramWriter } from "@prb/effect-solana";
import type { Idl } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const writer = yield* ProgramWriter;

  // Build instruction from IDL
  const instruction = yield* writer.build(
    idl,
    {
      method: "withdraw",
      args: [amount],
      accounts: {
        signer,
        streamRecipient,
        // ... other accounts
      },
    },
    programId,
  );
});
```

### PdaService

Program Derived Address utilities.

```typescript
import { PdaService } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const pda = yield* PdaService;
  const [address, bump] = yield* pda.derive(seeds, programId);
});
```

## Layer Composition

Compose services to build your application layer:

```typescript
import { Layer } from "effect";
import {
  BalanceServiceLive,
  RpcServiceLive,
  SignerServiceLive,
  TokenServiceLive,
  TransactionServiceLive,
  ProgramWriterLive,
} from "@prb/effect-solana";

// Create custom implementations
const MyRpcLayer = Layer.succeed(RpcService, {
  getRpc: () => Effect.succeed(/* ... */),
  getRpcUrl: () => Effect.succeed("https://api.devnet.solana.com"),
});

const MySignerLayer = Layer.succeed(SignerService, {
  getAddress: () => Effect.succeed(/* ... */),
  signTransaction: (tx) => Effect.succeed(/* ... */),
});

// Compose layers
const AppLayer = Layer.mergeAll(BalanceServiceLive, TokenServiceLive, TransactionServiceLive, ProgramWriterLive).pipe(
  Layer.provide(Layer.merge(MyRpcLayer, MySignerLayer)),
);
```

## Constants

The library exports common Solana constants:

```typescript
import {
  LAMPORTS_PER_SOL,
  ClusterEndpoints,
  SYSTEM_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
  TOKEN_2022_PROGRAM_ADDRESS,
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  COMPUTE_BUDGET_PROGRAM_ADDRESS,
  MEMO_PROGRAM_ADDRESS,
} from "@prb/effect-solana";

// Use cluster endpoints
const devnetUrl = ClusterEndpoints.devnet;
const mainnetUrl = ClusterEndpoints["mainnet-beta"];
```

## Types

Re-exported Solana types and custom definitions:

```typescript
import type {
  Address,
  Commitment,
  Lamports,
  Signature,
  TransactionError,
  Cluster,
  ClusterConfig,
  Microlamports,
} from "@prb/effect-solana";
```

## Error Handling

All errors are tagged for discriminated union handling:

```typescript
import { Effect } from "effect";
import { WalletNotConnectedError, TransactionFailedError, TransactionTimeoutError, RpcError } from "@prb/effect-solana";

const handled = program.pipe(
  Effect.catchTag("WalletNotConnectedError", (e) => Effect.succeed("Please connect wallet")),
  Effect.catchTag("TransactionFailedError", (e) => Effect.succeed(`TX failed: ${e.message}`)),
  Effect.catchTag("TransactionTimeoutError", (e) => Effect.succeed(`TX timed out: ${e.signature}`)),
  Effect.catchTag("RpcError", (e) => Effect.succeed(`RPC error at ${e.url}: ${e.message}`)),
);
```

## Telemetry

The library includes built-in OpenTelemetry spans for observability:

```typescript
import { SpanNames } from "@prb/effect-solana";

// Balance operations
SpanNames.BALANCE_GET_SOL;
SpanNames.BALANCE_WATCH_SOL;

// Transaction operations
SpanNames.TX_BUILD;
SpanNames.TX_SIGN;
SpanNames.TX_SEND;
SpanNames.TX_CONFIRM;
SpanNames.TX_SEND_AND_CONFIRM;
SpanNames.TX_SIMULATE;

// Token operations
SpanNames.TOKEN_GET_ATA;
SpanNames.TOKEN_CREATE_ATA;
SpanNames.TOKEN_GET_ACCOUNT;

// PDA operations
SpanNames.PDA_DERIVE;

// Program operations
SpanNames.PROGRAM_BUILD;
SpanNames.PROGRAM_CREATE;

// And more...
```

## React Integration

The library provides React hooks for integrating Solana operations into React applications:

```typescript
import { EffectSolanaProvider, useEffectMemo } from "@prb/effect-solana";
import { BalanceService } from "@prb/effect-solana";
import type { Address } from "@solana/kit";

function App() {
  return (
    <EffectSolanaProvider layer={MainLayer}>
      <Balance address={yourAddress} />
    </EffectSolanaProvider>
  );
}

function Balance({ address }: { address: Address }) {
  const result = useEffectMemo(
    () =>
      Effect.gen(function* () {
        const balance = yield* BalanceService;
        return yield* balance.getSolBalance(address);
      }),
    [address],
  );

  if (result.status === "loading") return <div>Loading...</div>;
  if (result.status === "error") return <div>Error: {result.error.message}</div>;
  return <div>Balance: {result.data} lamports</div>;
}
```

Available React hooks:

- `useEffectMemo` - Run an Effect with memoization
- `useEffectOnce` - Run an Effect once on mount
- `useStream` - Subscribe to an Effect Stream
- `useForkEffect` - Fork an Effect as a background fiber
- `EffectSolanaProvider` - Context provider for Effect runtime
- `useEffectSolanaRuntime` - Access the Effect runtime

## Examples

### Send SOL Transfer

```typescript
import { Effect } from "effect";
import { TransactionService } from "@prb/effect-solana";
import { getTransferSolInstruction } from "@solana-program/system";

const sendSol = (params: { from: Address; to: Address; amount: Lamports }) =>
  Effect.gen(function* () {
    const tx = yield* TransactionService;

    const instruction = getTransferSolInstruction({
      source: params.from,
      destination: params.to,
      amount: params.amount,
    });

    const receipt = yield* tx.sendAndConfirm([instruction]);
    return receipt.signature;
  });
```

### Watch Balance Changes

```typescript
import { Effect, Stream } from "effect";
import { BalanceService } from "@prb/effect-solana";

const watchBalance = (address: Address) =>
  Effect.gen(function* () {
    const balance = yield* BalanceService;
    const stream = yield* balance.watchBalance({ address });

    yield* Stream.runForEach(stream, (lamports) => Effect.sync(() => console.log(`Balance: ${lamports}`)));
  });
```

## License

MIT
