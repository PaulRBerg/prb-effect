import { HttpClient, HttpClientRequest, HttpClientResponse } from "@effect/platform";
import { Config, Effect, Schema } from "effect";
import type { Address, Hex } from "viem";
import {
  SimulationError,
  TenderlyApiError,
  TenderlyNotConfiguredError,
  TenderlyRateLimitError,
} from "@/src/simulation/index.js";
import type { SimulationResult, StateOverride, TraceCall } from "@/src/simulation/types.ts";

type TenderlySimulationRequest = {
  network_id: string;
  from: Address;
  to: Address;
  input?: Hex;
  value?: string;
  gas?: number;
  gas_price?: string;
  block_number?: number;
  state_objects?: Record<
    Address,
    {
      balance?: string;
      code?: Hex;
      nonce?: number;
      storage?: Record<Hex, Hex>;
    }
  >;
  save?: boolean;
  save_if_fails?: boolean;
  simulation_type?: "quick" | "full";
};

type TenderlySimulationResponse = {
  transaction: {
    hash: Hex;
    block_number: number;
    block_hash: Hex;
    from: Address;
    to: Address;
    gas: number;
    gas_price: string;
    gas_used: number;
    cumulative_gas_used: number;
    input: Hex;
    output?: Hex;
    nonce: number;
    value: string;
    status: boolean;
    error_message?: string;
  };
  simulation: {
    id: string;
    status: boolean;
  };
  logs: Array<{
    address: Address;
    topics: Hex[];
    data: Hex;
    name?: string;
    anonymous?: boolean;
    inputs?: Array<{
      name: string;
      type: string;
      value: unknown;
    }>;
  }>;
  trace?: Array<{
    type: string;
    from: Address;
    to: Address;
    value: string;
    gas: number;
    gas_used: number;
    input: Hex;
    output?: Hex;
    error?: string;
    calls?: unknown[];
  }>;
  state_diff?: Array<{
    address: Address;
    soltype?: {
      name: string;
      type: string;
    };
    original: Hex;
    dirty: Hex;
    raw: Array<{
      key: Hex;
      original: Hex;
      dirty: Hex;
    }>;
  }>;
};

const getTenderlyConfig = Effect.gen(function* () {
  const accessKey = yield* Config.string("TENDERLY_ACCESS_KEY").pipe(
    Effect.catchAll(() => Effect.succeed(undefined))
  );
  const account = yield* Config.string("TENDERLY_ACCOUNT").pipe(
    Effect.catchAll(() => Effect.succeed(undefined))
  );
  const project = yield* Config.string("TENDERLY_PROJECT").pipe(
    Effect.catchAll(() => Effect.succeed(undefined))
  );

  const missing: string[] = [];
  if (!accessKey) {
    missing.push("TENDERLY_ACCESS_KEY");
  }
  if (!account) {
    missing.push("TENDERLY_ACCOUNT");
  }
  if (!project) {
    missing.push("TENDERLY_PROJECT");
  }

  if (missing.length > 0) {
    return yield* Effect.fail(
      new TenderlyNotConfiguredError({
        message: `Missing Tenderly configuration: ${missing.join(", ")}`,
        missingConfig: missing,
      })
    );
  }

  return {
    accessKey: accessKey as string,
    account: account as string,
    project: project as string,
  };
});

function mapTenderlyResponse(response: TenderlySimulationResponse): SimulationResult {
  const tx = response.transaction;

  return {
    error: tx.error_message,
    gasLimit: BigInt(tx.gas),
    gasUsed: BigInt(tx.gas_used),
    logs:
      response.logs?.map((log) => ({
        address: log.address,
        data: log.data,
        decoded: log.name
          ? {
              args:
                log.inputs?.reduce(
                  (acc, input) => {
                    acc[input.name] = input.value;
                    return acc;
                  },
                  {} as Record<string, unknown>
                ) ?? {},
              eventName: log.name,
            }
          : undefined,
        topics: log.topics,
      })) ?? [],
    returnValue: tx.status ? (tx.output ?? response.trace?.[0]?.output) : undefined,
    revertReason: tx.error_message,
    stateDiff:
      response.state_diff?.flatMap((diff) =>
        diff.raw.map((raw) => ({
          address: diff.address,
          key: raw.key,
          modified: raw.dirty,
          original: raw.original,
        }))
      ) ?? [],
    success: tx.status,
    trace: response.trace ? mapTenderlyTrace(response.trace) : undefined,
  };
}

function mapTenderlyTrace(trace: TenderlySimulationResponse["trace"]): TraceCall[] {
  if (!trace) {
    return [];
  }

  return trace.map((call) => ({
    calls: call.calls ? mapTenderlyTrace(call.calls as TenderlySimulationResponse["trace"]) : [],
    error: call.error,
    from: call.from,
    gas: BigInt(call.gas),
    gasUsed: BigInt(call.gas_used),
    input: call.input,
    output: call.output,
    to: call.to,
    type: call.type.toUpperCase() as TraceCall["type"],
    value: BigInt(call.value),
  }));
}

function parseRetryAfterSeconds(value: string | undefined): number | undefined {
  if (!value) {
    return;
  }

  const asSeconds = Number(value);
  if (Number.isFinite(asSeconds)) {
    return asSeconds;
  }

  const asDate = Date.parse(value);
  if (!Number.isNaN(asDate)) {
    const deltaMs = asDate - Date.now();
    return deltaMs > 0 ? Math.ceil(deltaMs / 1000) : 0;
  }

  return;
}

function toTenderlyStateObjects(
  overrides: readonly StateOverride[] | undefined
): TenderlySimulationRequest["state_objects"] | undefined {
  if (!overrides || overrides.length === 0) {
    return;
  }

  const stateObjects: TenderlySimulationRequest["state_objects"] = {};
  for (const override of overrides) {
    stateObjects[override.address] = {
      balance: override.balance?.toString(),
      code: override.code,
      nonce: override.nonce ? Number(override.nonce) : undefined,
      storage: override.state,
    };
  }

  return stateObjects;
}

function toTenderlyRequestBody(params: {
  chainId: number;
  from: Address;
  to: Address;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
  blockNumber?: bigint;
  stateOverrides?: StateOverride[];
}): TenderlySimulationRequest {
  return {
    block_number: params.blockNumber ? Number(params.blockNumber) : undefined,
    from: params.from,
    gas: params.gas ? Number(params.gas) : undefined,
    input: params.data ?? "0x",
    network_id: params.chainId.toString(),
    save: false,
    save_if_fails: false,
    simulation_type: "full",
    state_objects: toTenderlyStateObjects(params.stateOverrides),
    to: params.to,
    value: params.value ? params.value.toString() : "0",
  };
}

function ensureTenderlyOk(response: HttpClientResponse.HttpClientResponse) {
  return Effect.gen(function* () {
    if (response.status === 429) {
      const retryAfter = parseRetryAfterSeconds(response.headers["retry-after"]);
      return yield* Effect.fail(
        new TenderlyRateLimitError({
          message: "Tenderly API rate limit exceeded",
          retryAfter,
        })
      );
    }

    if (response.status < 200 || response.status >= 300) {
      const body = yield* response.json.pipe(Effect.catchAll(() => Effect.succeed(undefined)));
      return yield* Effect.fail(
        new TenderlyApiError({
          message: "Tenderly API request failed",
          response: body,
          statusCode: response.status,
        })
      );
    }
  });
}

export function simulateTenderly(params: {
  chainId: number;
  from: Address;
  to: Address;
  data?: Hex;
  value?: bigint;
  gas?: bigint;
  blockNumber?: bigint;
  stateOverrides?: StateOverride[];
}) {
  return Effect.gen(function* () {
    const config = yield* getTenderlyConfig;
    const client = yield* HttpClient.HttpClient;

    const url = `https://api.tenderly.co/api/v1/account/${config.account}/project/${config.project}/simulate`;

    const requestBody = toTenderlyRequestBody(params);

    const request = yield* HttpClientRequest.post(url).pipe(
      HttpClientRequest.setHeader("X-Access-Key", config.accessKey),
      HttpClientRequest.setHeader("Content-Type", "application/json"),
      HttpClientRequest.bodyJson(requestBody),
      Effect.mapError(
        () =>
          new SimulationError({
            message: "Failed to serialize request body",
          })
      )
    );

    const response = yield* client.execute(request).pipe(
      Effect.mapError(
        (cause) =>
          new SimulationError({
            cause,
            message: "Failed to execute Tenderly request",
          })
      )
    );

    yield* ensureTenderlyOk(response);

    const body = yield* HttpClientResponse.schemaBodyJson(Schema.Unknown)(response).pipe(
      Effect.mapError(
        (cause) =>
          new SimulationError({
            cause,
            message: "Failed to decode Tenderly response body",
          })
      )
    );

    return mapTenderlyResponse(body as TenderlySimulationResponse);
  });
}

export function simulateBundleTenderly(params: {
  chainId: number;
  transactions: Array<{
    from: Address;
    to: Address;
    data?: Hex;
    value?: bigint;
  }>;
  blockNumber?: bigint;
}) {
  return Effect.gen(function* () {
    // Tenderly doesn't have a native bundle simulation endpoint
    // We simulate each transaction sequentially with state carryover
    const results: SimulationResult[] = [];
    const stateOverrides: StateOverride[] = [];

    for (const tx of params.transactions) {
      const result = yield* simulateTenderly({
        blockNumber: params.blockNumber,
        chainId: params.chainId,
        data: tx.data,
        from: tx.from,
        stateOverrides,
        to: tx.to,
        value: tx.value,
      });

      results.push(result);

      // Carry state changes forward
      // This is a simplified approach - in production you'd want more sophisticated state tracking
      for (const diff of result.stateDiff) {
        const existingOverride = stateOverrides.find((o) => o.address === diff.address);
        if (existingOverride) {
          existingOverride.state = {
            ...existingOverride.state,
            [diff.key]: diff.modified,
          };
        } else {
          stateOverrides.push({
            address: diff.address,
            state: {
              [diff.key]: diff.modified,
            },
          });
        }
      }
    }

    return results;
  });
}
