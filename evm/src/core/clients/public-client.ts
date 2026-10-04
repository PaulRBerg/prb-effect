import type { Effect } from "effect";
import { Context } from "effect";
import type { PublicClient } from "viem";
import type { ClientNotFoundError } from "#src/core/errors/index.js";

export type PublicClientServiceShape = {
  get: (chainId: number) => Effect.Effect<PublicClient, ClientNotFoundError>;
};

export class PublicClientService extends Context.Service<
  PublicClientService,
  PublicClientServiceShape
>()("ew3/PublicClient") {}
