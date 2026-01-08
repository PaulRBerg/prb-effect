# @prb/effect-solana

## Tech Stack

- **Solana Kit**: v2.x for Solana blockchain interactions
- **Solana Programs**: System, Token, Compute Budget programs

## Architecture

Type-safe, composable Solana abstractions built on Effect-TS and @solana/kit. Exports:

- `RpcService` — RPC client management per cluster
- `SignerService` — Wallet signing interface (adapter-agnostic)
- `BalanceService` — SOL balance queries
- `TokenService` — SPL token operations (ATA, balances)
- `TransactionService` — Transaction lifecycle (build, sign, send, confirm)
- `PdaService` — Program Derived Address utilities
- `ProgramWriter` — Anchor IDL-based instruction building

**High-level flow:**

1. Configure cluster and RPC endpoints
2. Provide a Layer (`RpcServiceLive`, `SignerServiceLive`, etc.)
3. Read SOL/token balances via `BalanceService`/`TokenService`
4. Build instructions via `ProgramWriter` (from Anchor IDL)
5. Execute transactions via `TransactionService`
6. Use telemetry spans for observability

## Commands

```bash
just build        # Build library (tsc + tsc-alias + npm pack)
just test         # Run tests with Vitest
just test-ui      # Run tests with Vitest UI
just clean        # Remove dist/
```

**Aliases:** `just b` (build), `just t` (test), `just tui` (test-ui)

## Module Structure

```
src/
├── balance/        # SOL balance queries
├── constants/      # Cluster endpoints, program addresses
├── core/           # Core errors (RPC, transaction, wallet, account)
├── internal/       # Internal utilities (not exported)
├── pda/            # PDA derivation utilities
├── presets/        # Layer factories for common setups
├── program/        # ProgramWriter (Anchor IDL → instructions)
├── react-hooks/    # React integration hooks
├── rpc/            # RpcService
├── signer/         # SignerService
├── telemetry/      # Span names for tracing
├── testing-kit/    # Test utilities (mocks, fixtures)
├── token/          # SPL token operations
├── tx/             # TransactionService
├── types/          # Shared type definitions
├── web3.js/        # @solana/web3.js v1 interop (legacy signer, transaction bridge)
└── index.ts        # Barrel exports
```

## Solana Integration

- Services wrap @solana/kit APIs for RPC communication
- Full type safety for Solana transactions and accounts
- Effect-based error handling for network and validation errors
