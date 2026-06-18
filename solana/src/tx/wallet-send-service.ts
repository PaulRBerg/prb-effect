import type { Signature } from "@solana/keys";
import type { Transaction, TransactionWithLifetime } from "@solana/transactions";
import { Context, Effect, Layer } from "effect";
import type {
  TransactionSendError,
  UserRejectedError,
  WalletCapabilityError,
  WalletNotConnectedError,
} from "#src/core/errors/index.js";
import { WalletCapabilityError as WalletCapabilityErrorClass } from "#src/core/errors/index.js";
import type { WalletSendOpts } from "./types.js";

/**
 * Shape of the WalletSendService for provider-owned sign-and-send flows.
 *
 * @category Services
 */
export type WalletSendServiceShape = {
  /**
   * Send a compiled transaction through the connected wallet/provider.
   */
  readonly sendTransaction: (
    tx: Transaction & TransactionWithLifetime,
    opts?: WalletSendOpts
  ) => Effect.Effect<
    Signature,
    TransactionSendError | UserRejectedError | WalletCapabilityError | WalletNotConnectedError
  >;
};

/**
 * Service tag for wallet-provider send operations.
 *
 * @category Services
 */
export class WalletSendService extends Context.Tag("esolana/WalletSendService")<
  WalletSendService,
  WalletSendServiceShape
>() {}

/**
 * A WalletSendService layer that makes unsupported wallet-send paths explicit.
 *
 * @category Layers
 */
export const WalletSendServiceUnsupported = Layer.succeed(
  WalletSendService,
  WalletSendService.of({
    sendTransaction: () =>
      Effect.fail(
        new WalletCapabilityErrorClass({
          capability: "sendTransaction",
          message: "Wallet sendTransaction capability is not configured",
        })
      ),
  })
);
