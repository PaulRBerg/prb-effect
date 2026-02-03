# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Common Changelog](https://common-changelog.org/).

[1.0.0]: https://github.com/PaulRBerg/prb-effect/releases/tag/%40prb%2Feffect-evm%401.0.0

## [1.0.0] - 2026-02-03

### Added

- Add Contract services: `ContractReader` (multicall), `ContractWriter`, `ContractPipeline`, `typedContract`
- Add Transaction management with `TxManager` and reactive state tracking
- Add Event streams: `EventStream`, `ReliableEventStream` with confirmation filtering and reorg handling
- Add Chain utilities: `BalanceService`, `BlockService`, `GasService`, `NonceService`
- Add Deploy and NFT services: `DeployService`, `Erc721Service`
- Add Signature and simulation: `SignatureService`, `SimulationService` (Tenderly)
- Add Subscriptions: `SubscriptionService` for blocks, logs, and pending transactions
- Add EIP-7702 delegation and atomic batching for EOAs
- Add React hooks via `@prb/effect-evm/react-hooks`
- Add Safe detection hooks: `useIsSafeAppContext`, `useIsHostSafeApp`, `useIsSafeMultisigWallet`
- Add Wagmi integration via `@prb/effect-evm/wagmi`
- Add Browser persistence utilities in `browser` namespace
- Add Testing kit via `@prb/effect-evm/testing-kit`
