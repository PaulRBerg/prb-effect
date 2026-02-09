import { HttpClient } from "@effect/platform";
import { Context, Effect, Layer } from "effect";
import type { Abi, Address, Hex } from "viem";
import { formatEther } from "viem";
import { formatPercent } from "#src/internal/index.js";
import type {
  SimulationError,
  SimulationResult,
  StateOverride,
  TenderlyApiError,
  TenderlyNotConfiguredError,
  TenderlyRateLimitError,
} from "#src/simulation/index.js";
import { simulateBundleTenderly, simulateTenderly } from "#src/simulation/index.js";
import { SpanNames } from "#src/telemetry/index.js";

type TenderlyErrors =
  | SimulationError
  | TenderlyApiError
  | TenderlyNotConfiguredError
  | TenderlyRateLimitError;

function formatSimulationSummary(result: SimulationResult): string {
  return [
    formatStatusLine(result),
    formatGasLine(result),
    ...formatErrorLines(result),
    ...formatReturnValueLines(result),
    ...formatLogsLines(result.logs),
    ...formatStateDiffLines(result.stateDiff),
    ...formatTraceLines(result.trace),
  ].join("\n");
}

function formatStatusLine(result: SimulationResult): string {
  return `Status: ${result.success ? "✓ Success" : "✗ Failed"}`;
}

function formatGasLine(result: SimulationResult): string {
  const gasPercent =
    result.gasLimit > 0n ? formatPercent(Number(result.gasUsed) / Number(result.gasLimit)) : "0%";
  return `Gas: ${result.gasUsed.toLocaleString()} / ${result.gasLimit.toLocaleString()} (${gasPercent})`;
}

function formatErrorLines(result: SimulationResult): readonly string[] {
  const lines: string[] = [];
  if (result.error) {
    lines.push(`Error: ${result.error}`);
  }
  if (result.revertReason) {
    lines.push(`Revert Reason: ${result.revertReason}`);
  }
  return lines;
}

function formatReturnValueLines(result: SimulationResult): readonly string[] {
  return result.returnValue ? [`Return Value: ${result.returnValue}`] : [];
}

function formatLogArgValue(value: unknown): string {
  if (typeof value === "bigint") {
    if (value > 1000000000000000n) {
      return `${formatEther(value)} ETH`;
    }
    return value.toLocaleString();
  }
  return String(value);
}

function formatLogsLines(logs: SimulationResult["logs"]): readonly string[] {
  if (logs.length === 0) {
    return [];
  }

  const lines: string[] = ["", `Events (${logs.length}):`];
  for (const [i, log] of logs.entries()) {
    const index = i + 1;
    if (log.decoded) {
      lines.push(`  ${index}. ${log.decoded.eventName}`);
      for (const [key, value] of Object.entries(log.decoded.args)) {
        lines.push(`     ${key}: ${formatLogArgValue(value)}`);
      }
      continue;
    }

    lines.push(`  ${index}. Log at ${log.address}`);
    lines.push(`     Topics: ${log.topics.length}`);
  }

  return lines;
}

function formatStateDiffLines(stateDiff: SimulationResult["stateDiff"]): readonly string[] {
  if (stateDiff.length === 0) {
    return [];
  }

  const byAddress = new Map<Address, number>();
  for (const diff of stateDiff) {
    byAddress.set(diff.address, (byAddress.get(diff.address) ?? 0) + 1);
  }

  const lines: string[] = ["", `State Changes (${stateDiff.length}):`];
  for (const [address, count] of byAddress) {
    lines.push(`  ${address}: ${count} storage slot(s) modified`);
  }
  return lines;
}

type Trace = NonNullable<SimulationResult["trace"]>;
type TraceCall = Trace[number];
type TraceStackItem = { readonly call: TraceCall; readonly indent: number };

function formatTraceCallLines(call: TraceCall, indent: number): readonly string[] {
  const spaces = " ".repeat(indent);
  const valueStr = call.value > 0n ? ` {${formatEther(call.value)} ETH}` : "";
  const errorStr = call.error ? ` [ERROR: ${call.error}]` : "";

  return [
    `${spaces}${call.type} ${call.from} → ${call.to}${valueStr}${errorStr}`,
    `${spaces}  Gas: ${call.gasUsed.toLocaleString()} / ${call.gas.toLocaleString()}`,
  ];
}

function pushTraceChildren(
  stack: TraceStackItem[],
  children: readonly TraceCall[] | undefined,
  indent: number
): void {
  if (!children || children.length === 0) {
    return;
  }

  for (let i = children.length - 1; i >= 0; i--) {
    const child = children[i];
    if (child) {
      stack.push({ call: child, indent });
    }
  }
}

function pushTraceRootCalls(stack: TraceStackItem[], trace: readonly TraceCall[]): void {
  for (let i = trace.length - 1; i >= 0; i--) {
    const call = trace[i];
    if (call) {
      stack.push({ call, indent: 2 });
    }
  }
}

function formatTraceLines(trace: SimulationResult["trace"]): readonly string[] {
  if (!trace || trace.length === 0) {
    return [];
  }

  const lines: string[] = ["", "Call Trace:"];
  const stack: TraceStackItem[] = [];
  pushTraceRootCalls(stack, trace);

  while (stack.length > 0) {
    const item = stack.pop();
    if (!item) {
      break;
    }
    lines.push(...formatTraceCallLines(item.call, item.indent));
    pushTraceChildren(stack, item.call.calls, item.indent + 2);
  }

  return lines;
}

export type SimulationServiceShape = {
  readonly simulate: (params: {
    chainId: number;
    from: Address;
    to: Address;
    data?: Hex;
    value?: bigint;
    gas?: bigint;
    blockNumber?: bigint;
    stateOverrides?: StateOverride[];
  }) => Effect.Effect<SimulationResult, TenderlyErrors>;

  readonly simulateBundle: (params: {
    chainId: number;
    transactions: Array<{
      from: Address;
      to: Address;
      data?: Hex;
      value?: bigint;
    }>;
    blockNumber?: bigint;
  }) => Effect.Effect<SimulationResult[], TenderlyErrors>;

  readonly getReadableSummary: (result: SimulationResult, abi?: Abi) => Effect.Effect<string>;
};

export class SimulationService extends Context.Tag("ew3/SimulationService")<
  SimulationService,
  SimulationServiceShape
>() {}

export const SimulationServiceLive = Layer.effect(
  SimulationService,
  Effect.gen(function* () {
    const httpClient = yield* HttpClient.HttpClient;
    const httpClientLayer = Layer.succeed(HttpClient.HttpClient, httpClient);

    return {
      getReadableSummary: (result: SimulationResult, _abi?: Abi) =>
        Effect.sync(() => formatSimulationSummary(result)),

      simulate: (params) =>
        simulateTenderly(params).pipe(
          Effect.provide(httpClientLayer),
          Effect.withSpan(SpanNames.SIMULATION_SIMULATE, {
            attributes: {
              chainId: params.chainId,
              from: params.from,
              gas: params.gas?.toString(),
              to: params.to,
              value: params.value?.toString(),
            },
          })
        ),

      simulateBundle: (params) =>
        simulateBundleTenderly(params).pipe(
          Effect.provide(httpClientLayer),
          Effect.withSpan(SpanNames.SIMULATION_SIMULATE_BUNDLE, {
            attributes: {
              chainId: params.chainId,
              transactionCount: params.transactions.length,
            },
          })
        ),
    };
  })
);
