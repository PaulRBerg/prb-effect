import type { Scope } from "effect";
import { Effect } from "effect";
import type { Abi, Hash, TransactionReceipt } from "viem";
import type { ContractWriterShape } from "#src/contract/index.js";
import type {
  ClientNotFoundError,
  ContractReadError,
  ContractWriteError,
  EventDecodeError,
  GasEstimationError,
  InsufficientFundsError,
  ReceiptTimeoutError,
  ResourceExhaustionError,
  SimulationFailedError,
  TransportError,
  TxFailedError,
  UserRejectedError,
  WalletNotConnectedError,
  WrongNetworkError,
} from "#src/core/index.js";
import type { EventStreamShape } from "#src/events/index.js";
import type { GasPriceUnavailableError, GasServiceShape } from "#src/gas/index.js";
import type { NonceServiceShape } from "#src/nonce/index.js";
import type { TxManagerShape, TxPolicy } from "#src/tx/index.js";
import { defaultPolicy } from "#src/tx/index.js";
import type { ContractFunctionName } from "#src/types/index.js";
import type { PipelineHooks, WriteAndTrackParams, WriteAndTrackResult } from "../types.js";
import { confirmNonce, withNonceReservation } from "./nonce.js";
import { deriveBaseOverrides, runPreflight } from "./prepare.js";
import { waitForReceiptFollowingReplacements } from "./receipt.js";

/**
 * Dependencies required by the core pipeline
 */
export type CorePipelineDeps = {
  readonly writer: ContractWriterShape;
  readonly txManager: TxManagerShape;
  readonly eventStream: EventStreamShape;
  readonly nonceService: NonceServiceShape;
  readonly gasService: GasServiceShape;
};

type CorePipelineError =
  | SimulationFailedError
  | ContractReadError
  | GasEstimationError
  | ContractWriteError
  | InsufficientFundsError
  | ResourceExhaustionError
  | UserRejectedError
  | GasPriceUnavailableError
  | TxFailedError
  | ReceiptTimeoutError
  | ClientNotFoundError
  | TransportError
  | WalletNotConnectedError
  | WrongNetworkError
  | EventDecodeError;

/**
 * Run the core write pipeline with hooks for tracking.
 *
 * Steps:
 * 1. Derive base overrides (tx type + fees)
 * 2. Run preflight (strict | best-effort | none)
 * 4. Reserve nonce
 * 5. Write transaction
 * 6. Wait for receipt (following replacements)
 * 7. Decode events
 */
export const runCorePipeline = <
  TAbi extends Abi,
  TFunctionName extends ContractFunctionName<TAbi, "nonpayable" | "payable">,
>(
  deps: CorePipelineDeps,
  params: WriteAndTrackParams<TAbi, TFunctionName>,
  policy: TxPolicy,
  hooks: PipelineHooks = {}
): Effect.Effect<WriteAndTrackResult<TAbi>, CorePipelineError, Scope.Scope> =>
  Effect.gen(function* () {
    const { writer, txManager, eventStream, nonceService, gasService } = deps;
    const mergedPolicy = { ...defaultPolicy, ...policy };

    // Step 1: Derive base overrides
    const baseOverrides = yield* deriveBaseOverrides(gasService, {
      chainId: params.chainId,
      policy: mergedPolicy,
      userOverrides: params.overrides,
    });

    // Step 2: Run preflight
    const { finalGas, overridesWithGas } = yield* runPreflight(
      writer,
      params,
      baseOverrides,
      mergedPolicy,
      {
        mode: params.preflight?.mode,
        onSimulating: hooks.onSimulating,
      }
    );

    // Step 4: Reserve nonce
    const explicitNonce = params.overrides?.nonce;
    const nonceReservation = yield* withNonceReservation(nonceService, {
      account: params.account,
      chainId: params.chainId,
      explicitNonce,
    });

    const finalOverrides = {
      ...overridesWithGas,
      nonce: nonceReservation.nonce,
    };

    if (hooks.onEstimated && finalGas != null) {
      yield* hooks.onEstimated(finalGas, nonceReservation.nonce);
    }

    // Step 5: Sign and write transaction
    if (hooks.onSigning) {
      yield* hooks.onSigning();
    }

    const hash = yield* writer.write({ ...params, overrides: finalOverrides });
    yield* nonceReservation.markSubmitted;

    if (hooks.onSubmitted) {
      yield* hooks.onSubmitted(hash);
    }

    // Step 6: Wait for receipt
    const onReplacedHook = hooks.onReplaced;
    const receipt: TransactionReceipt = yield* waitForReceiptFollowingReplacements(txManager, {
      chainId: params.chainId,
      hash,
      onReplaced: onReplacedHook
        ? (oldHash, newHash, reason) => onReplacedHook(oldHash, newHash, reason)
        : undefined,
      policy: mergedPolicy,
    });

    if (hooks.onMined) {
      yield* hooks.onMined(receipt);
    }

    // Confirm nonce after successful mining
    yield* confirmNonce(nonceService, {
      account: params.account,
      chainId: params.chainId,
      nonce: nonceReservation.nonce,
      reserved: nonceReservation.reserved,
    });

    // Step 7: Decode events
    const events = (yield* eventStream.decodeReceipt(
      receipt,
      params.abi
    )) as WriteAndTrackResult<TAbi>["events"];

    return {
      events,
      hash: receipt.transactionHash as Hash,
      receipt,
    } as WriteAndTrackResult<TAbi>;
  });
