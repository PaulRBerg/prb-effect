# @prb/effect-solana

[![npm version](https://img.shields.io/npm/v/@prb/effect-solana.svg)](https://www.npmjs.com/package/@prb/effect-solana)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

> [!WARNING]
>
> This is experimental, beta software. It is provided "as is" without warranty of any kind, express or implied.

Effect-TS integration for the Solana blockchain ecosystem. Type-safe, composable abstractions built on
[@solana/web3.js](https://github.com/solana-labs/solana-web3.js).

## 📦 Installation

```bash
npm install @prb/effect-solana effect
# or
pnpm add @prb/effect-solana effect
# or
bun add @prb/effect-solana effect
```

### Peer Dependencies

Required:

- `effect` ^3.x
- `@solana/web3.js` ^1.98.4

Optional:

- `@coral-xyz/anchor` ^0.32.1 (for Anchor IDL support)
- `react`, `react-dom` (for React hooks)

## 🚀 Quick Start

```typescript
import { Effect, Layer } from "effect";
import { BalanceService, makeSolanaLayer } from "@prb/effect-solana";
import type { Address } from "@prb/effect-solana";

// Create a complete Solana layer
const SolanaLayer = makeSolanaLayer(
  { cluster: "devnet" },
  () => walletAdapter, // your wallet adapter
);

// Read SOL balance
const program = Effect.gen(function* () {
  const balance = yield* BalanceService;
  const address = "YOUR_ADDRESS" as Address;
  return yield* balance.getSolBalance(address);
});

Effect.runPromise(Effect.provide(program, SolanaLayer));
```

## 🔧 Services

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

SPL token operations (supports both Token and Token-2022 programs).

```typescript
import { TokenService, TOKEN_2022_PROGRAM_ADDRESS } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const token = yield* TokenService;

  // Get associated token address
  const ata = yield* token.getAssociatedTokenAddress({ owner, mint });

  // Token-2022 support
  const ata2022 = yield* token.getAssociatedTokenAddress({
    owner,
    mint,
    tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
  });

  // Get or create ATA
  const { address, instruction } = yield* token.getOrCreateATA({
    owner,
    mint,
    payer,
  });

  // Get token balance
  const balance = yield* token.getTokenBalance(ata);

  // Build transfer instruction
  const transfer = yield* token.getTransferInstruction({
    source: ata,
    destination: recipientAta,
    authority: owner,
    amount: 1_000_000n,
  });
});
```

### TransactionService

Transaction lifecycle management.

```typescript
import { TransactionService } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const tx = yield* TransactionService;

  // Build transaction with compute budget
  const message = yield* tx.build(instructions, {
    computeBudget: { unitLimit: 600_000, microLamports: 10_000 },
  });

  // Sign, send, and confirm
  const signed = yield* tx.sign(message);
  const signature = yield* tx.send(signed);
  const receipt = yield* tx.confirm(signature, {
    commitment: "confirmed",
    timeout: 60_000,
  });

  // Or all at once
  const receipt2 = yield* tx.sendAndConfirm(instructions, {
    commitment: "confirmed",
  });

  // Batch transactions
  const receipts = yield* tx.sendAndConfirmBatch([{ instructions }, { instructions: [instruction2] }], {
    concurrency: 2,
    confirm: { commitment: "confirmed" },
  });
});
```

### ProgramWriter

Build instructions from Anchor IDLs.

```typescript
import { ProgramWriter } from "@prb/effect-solana";
import type { Idl } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const writer = yield* ProgramWriter;

  const instruction = yield* writer.build(
    idl,
    {
      method: "withdraw",
      args: [amount],
      accounts: { signer, streamRecipient /* ... */ },
    },
    programId,
  );
});
```

### ProgramReader

Read on-chain state via Anchor's `.view()` (signer-path reads).

`.view()` requires a connected wallet — Anchor uses the signer's publicKey as the payer for the simulated transaction.
For disconnected or low-balance wallets, use the simulator fallback path at the application level.

Anchor `BN` return values are normalized to native `bigint` at the package boundary. Values Anchor already decodes as
`number`, including small integers and floats, stay `number`. Result generics are caller assertions, not runtime schema
validation.

```typescript
import { Effect } from "effect";
import { ProgramReader } from "@prb/effect-solana";
import type { Idl } from "@prb/effect-solana";

const program = Effect.gen(function* () {
  const reader = yield* ProgramReader;

  // Single read
  const result = yield* reader.view<bigint>({
    idl,
    method: "getWithdrawableAmount",
    args: [streamId],
    accounts: { stream, streamRecipient },
    programId,
  });

  // Batched reads (reuse the program instance)
  const anchorProgram = yield* reader.createProgram({ idl, programId });
  const amount = yield* reader.viewWithProgram<Idl, bigint>(anchorProgram, {
    method: "getWithdrawableAmount",
    args: [streamId],
    accounts: { stream, streamRecipient },
  });
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

## 🧩 Layer Composition

### Using Presets

```typescript
import { makeSolanaLayer, makeRpcLayer, makeSignerLayer } from "@prb/effect-solana";

// Complete layer with all services
const AppLayer = makeSolanaLayer({ cluster: "devnet" }, () => walletAdapter);

// Or compose manually
const rpcLayer = makeRpcLayer({ cluster: "devnet", rpcUrl: "https://my-rpc.com" });
const signerLayer = makeSignerLayer(() => walletAdapter);
```

### Manual Composition

```typescript
import { Layer } from "effect";
import {
  BalanceServiceLive,
  PdaServiceLive,
  ProgramReaderLive,
  RpcService,
  SignerService,
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
const AppLayer = Layer.mergeAll(
  BalanceServiceLive,
  TokenServiceLive,
  TransactionServiceLive,
  PdaServiceLive,
  ProgramReaderLive,
  ProgramWriterLive,
).pipe(Layer.provide(Layer.merge(MyRpcLayer, MySignerLayer)));
```

## ⚛️ React Integration

```typescript
import { EffectSolanaProvider, useEffectMemo } from "@prb/effect-solana";
import { BalanceService } from "@prb/effect-solana";

function App() {
  return (
    <EffectSolanaProvider layer={AppLayer}>
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
    [address]
  );

  if (result.status === "loading") return <div>Loading...</div>;
  if (result.status === "error") return <div>Error: {result.error.message}</div>;
  return <div>Balance: {result.data} lamports</div>;
}
```

### Available Hooks

- `useEffectMemo` - Run an Effect with memoization
- `useEffectOnce` - Run an Effect once on mount
- `useStream` - Subscribe to an Effect Stream
- `useForkEffect` - Fork an Effect as a background fiber
- `useEffectSolanaRuntime` - Access the Effect runtime

## 🚨 Error Handling

All errors are tagged for discriminated union handling:

```typescript
import { Effect } from "effect";
import {
  WalletNotConnectedError,
  TransactionFailedError,
  TransactionTimeoutError,
  RpcError,
  catchUserRejection,
} from "@prb/effect-solana";

const handled = program.pipe(
  Effect.catchTag("WalletNotConnectedError", () => Effect.succeed("Please connect wallet")),
  Effect.catchTag("TransactionFailedError", (e) => Effect.succeed(`TX failed: ${e.message}`)),
  Effect.catchTag("TransactionTimeoutError", (e) => Effect.succeed(`TX timed out: ${e.signature}`)),
  Effect.catchTag("RpcError", (e) => Effect.succeed(`RPC error: ${e.message}`)),
);

// Convenience operator for user rejections
const result = sendTransaction(tx).pipe(catchUserRejection(null));
```

### Error Types

| Error                      | Description                        |
| -------------------------- | ---------------------------------- |
| `RpcError`                 | RPC communication failure          |
| `WalletNotConnectedError`  | Wallet not connected               |
| `SignatureError`           | Transaction signing failed         |
| `UserRejectedError`        | User rejected the transaction      |
| `TransactionSendError`     | Failed to send transaction         |
| `TransactionFailedError`   | Transaction execution failed       |
| `TransactionTimeoutError`  | Transaction confirmation timed out |
| `BlockhashExpiredError`    | Blockhash expired before confirm   |
| `SimulationFailedError`    | Transaction simulation failed      |
| `AccountNotFoundError`     | Account does not exist             |
| `InsufficientBalanceError` | Insufficient SOL balance           |

## 📊 Telemetry

Built-in OpenTelemetry spans for observability:

```typescript
import { SpanNames } from "@prb/effect-solana";

// Examples: SpanNames.TX_SEND, SpanNames.BALANCE_GET_SOL, SpanNames.TOKEN_GET_ATA
```

## 📚 Constants

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
```

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](../LICENSE) file for details.
