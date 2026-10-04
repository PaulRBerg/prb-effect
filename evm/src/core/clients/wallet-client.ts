import type { Effect } from "effect";
import { Context } from "effect";
import type { WalletClient } from "viem";
import type { WalletNotConnectedError, WrongNetworkError } from "#src/core/errors/index.js";

export type WalletClientServiceShape = {
  get: (
    chainId: number
  ) => Effect.Effect<WalletClient, WalletNotConnectedError | WrongNetworkError>;
};

export class WalletClientService extends Context.Service<
  WalletClientService,
  WalletClientServiceShape
>()("ew3/WalletClient") {}
