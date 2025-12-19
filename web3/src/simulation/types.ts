import type { Address, Hex } from "viem";

export type SimulatedLog = {
  address: Address;
  topics: Hex[];
  data: Hex;
  decoded?: {
    eventName: string;
    args: Record<string, unknown>;
  };
};

export type StateDiff = {
  address: Address;
  key: Hex;
  original: Hex;
  modified: Hex;
};

export type TraceCall = {
  type: "CALL" | "DELEGATECALL" | "STATICCALL" | "CREATE" | "CREATE2";
  from: Address;
  to: Address;
  value: bigint;
  gas: bigint;
  gasUsed: bigint;
  input: Hex;
  output?: Hex;
  error?: string;
  calls?: TraceCall[];
};

export type SimulationResult = {
  success: boolean;
  gasUsed: bigint;
  gasLimit: bigint;
  returnValue?: Hex;
  error?: string;
  revertReason?: string;
  logs: SimulatedLog[];
  stateDiff: StateDiff[];
  trace?: TraceCall[];
};

export type StateOverride = {
  address: Address;
  balance?: bigint;
  nonce?: bigint;
  code?: Hex;
  state?: Record<Hex, Hex>;
};
