import { Effect } from "effect";

/**
 * Wrap an effect with a span for tracing.
 */
export const withSpan =
  (name: string, attributes?: Record<string, unknown>) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.withSpan(name, { attributes })(effect);

/**
 * Common span names for Solana operations.
 */
export const SpanNames = {
  // Account Operations
  ACCOUNT_GET_INFO: "esol.account.getInfo",
  ACCOUNT_GET_MULTIPLE: "esol.account.getMultiple",
  ACCOUNT_WATCH: "esol.account.watch",

  // Balance Operations
  BALANCE_GET_SOL: "esol.balance.getSol",
  BALANCE_GET_TOKEN: "esol.balance.getToken",
  BALANCE_WATCH_SOL: "esol.balance.watchSol",
  BALANCE_WATCH_TOKEN: "esol.balance.watchToken",

  // Compute Budget Operations
  COMPUTE_SET_LIMIT: "esol.compute.setLimit",
  COMPUTE_SET_PRICE: "esol.compute.setPrice",
  EVENT_WATCH_ACCOUNT: "esol.event.watchAccount",

  // Event Operations
  EVENT_WATCH_LOGS: "esol.event.watchLogs",
  EVENT_WATCH_PROGRAM: "esol.event.watchProgram",

  // PDA Operations
  PDA_DERIVE: "esol.pda.derive",
  PDA_DERIVE_ADDRESS: "esol.pda.deriveAddress",
  PDA_DERIVE_BUMP: "esol.pda.deriveBump",
  PDA_FIND: "esol.pda.find",

  // Program Operations
  PROGRAM_BUILD: "esol.program.build",
  PROGRAM_BUILD_INSTRUCTION: "esol.program.buildInstruction",
  PROGRAM_CREATE: "esol.program.create",
  RPC_GET_ACCOUNT_INFO: "esol.rpc.getAccountInfo",
  // RPC Operations
  RPC_GET_BALANCE: "esol.rpc.getBalance",
  RPC_GET_BLOCK: "esol.rpc.getBlock",
  RPC_GET_BLOCK_HEIGHT: "esol.rpc.getBlockHeight",
  RPC_GET_BLOCK_TIME: "esol.rpc.getBlockTime",
  RPC_GET_PROGRAM_ACCOUNTS: "esol.rpc.getProgramAccounts",
  RPC_GET_SLOT: "esol.rpc.getSlot",

  // Signer Operations
  SIGNER_GET_ADDRESS: "esol.signer.getAddress",
  SIGNER_GET_SIGNER: "esol.signer.getSigner",

  // Token Operations
  TOKEN_ACCOUNT_EXISTS: "esol.token.accountExists",
  TOKEN_APPROVE: "esol.token.approve",
  TOKEN_BURN: "esol.token.burn",
  TOKEN_CREATE_ATA: "esol.token.createAta",
  TOKEN_GET_ACCOUNT: "esol.token.getAccount",
  TOKEN_GET_ATA: "esol.token.getAta",
  TOKEN_GET_MINT: "esol.token.getMint",
  TOKEN_MINT_TO: "esol.token.mintTo",
  TOKEN_REVOKE: "esol.token.revoke",
  TOKEN_TRANSFER: "esol.token.transfer",

  // Transaction Operations
  TX_BUILD: "esol.tx.build",
  TX_CONFIRM: "esol.tx.confirm",
  TX_GET_SIGNATURE_STATUSES: "esol.tx.getSignatureStatuses",
  TX_SEND: "esol.tx.send",
  TX_SEND_AND_CONFIRM: "esol.tx.sendAndConfirm",
  TX_SIGN: "esol.tx.sign",
  TX_SIMULATE: "esol.tx.simulate",
} as const;
