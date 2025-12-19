# @prb/effect-web3

## Tech Stack

- **Viem**: v2.x for EVM interactions

## Architecture

Type-safe, composable Web3 abstractions built on Effect-TS and viem. Exports:

- `ContractReader` — read-only smart contract operations with multicall support
- `ContractWriter` — low-level write operations requiring a connected wallet
- `ContractPipeline` — high-level writes (simulate → estimate → send → wait → decode)
- `TxManager` — reactive transaction lifecycle tracking
- `EventStream` — watch and decode contract events
- `ReliableEventStream` — confirmation-gated, reorg-filtered event emissions
- `typedContract` — type-safe contract helper with ABI baked in
- `TransferService` — native token and cross-chain transfers
- `CrossChainReader` — read contracts across multiple chains

**High-level flow:**

1. Configure chain RPCs (`ChainConfig[]`)
2. Provide a Layer (`makeEffectWeb3Layer` for dapps, `makePublicClientLayer` for read-only)
3. Read via `ContractReader` (or `typedContract`)
4. Write via `ContractPipeline` (preferred) or `ContractWriter` (low-level)
5. Stream events via `EventStream` (or `ReliableEventStream` for confirmations)
6. In tests, use `effect-web3/testing-kit`

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
├── abi/            # Standard ABIs (ERC-20, ERC-721, ERC-165)
├── balance/        # Balance utilities
├── block/          # Block service
├── constants/      # Chain constants and addresses
├── contract/       # ContractReader, ContractWriter, ContractPipeline
├── core/           # PublicClientService, WalletClientService, errors
├── deploy/         # Contract deployment
├── eip7702/        # EIP-7702 delegation helpers
├── ens/            # ENS resolution
├── erc20/          # ERC-20 services
├── erc721/         # ERC-721 services
├── events/         # EventStream, ReliableEventStream
├── gas/            # Gas estimation
├── integrations/   # Third-party integrations
├── internal/       # Internal utilities (not exported)
├── nonce/          # Nonce management
├── platform/       # Platform-specific (browser persistence)
├── presets/        # Layer factories, transport helpers
├── query/          # Query/cache layer, multicall batcher
├── react-hooks/    # React hooks
├── rpc/            # Retry, circuit breaker, cache, deduplication
├── safe/           # Safe wallet integration
├── signature/      # Signature utilities
├── simulation/     # Tenderly simulation
├── subscriptions/  # Block, log, pending tx subscriptions
├── telemetry/      # Tracing and logging
├── testing-kit/    # Test utilities (exported as effect-web3/testing-kit)
├── transfer/       # Native token transfers
├── tx/             # TxManager, transaction lifecycle
├── types/          # Shared type definitions
├── wagmi/          # Wagmi integration
└── wallet/         # WalletClientService, wallet operations
```

## Viem Integration

- Services wrap viem clients (`PublicClient`, `WalletClient`)
- Transport helpers (`makeHttpTransport`, `makeFallbackTransport`) configure RPC connections
- Full ABI type inference from viem preserved
