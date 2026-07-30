import { Context, Effect, Layer } from "effect";
import { erc20Abi, maxUint256 } from "viem";
import { erc20NoOutputAbi } from "#src/abi/index.js";
import { ContractReader, ContractWriter } from "#src/contract/index.js";
import type {
  ClientNotFoundError,
  InsufficientFundsError,
  ResourceExhaustionError,
  UserRejectedError,
} from "#src/core/index.js";
import { ApprovalCheckError, ApprovalError } from "#src/core/index.js";
import type {
  ApproveParams,
  CheckAllowanceParams,
  EnsureAllowanceParams,
  Erc20AllowanceServiceShape,
} from "#src/erc20/allowance/index.js";

export class Erc20NoOutputAllowanceService extends Context.Tag("ew3/Erc20NoOutputAllowanceService")<
  Erc20NoOutputAllowanceService,
  Erc20AllowanceServiceShape
>() {}

export const Erc20NoOutputAllowanceServiceLive = Layer.effect(
  Erc20NoOutputAllowanceService,
  Effect.gen(function* () {
    const reader = yield* ContractReader;
    const writer = yield* ContractWriter;

    const approve = Effect.fn("approve")(function* (params: ApproveParams) {
      const writeParams = {
        abi: erc20NoOutputAbi,
        account: params.account,
        address: params.tokenAddress,
        args: [params.spender, params.amount] as const,
        chainId: params.chainId,
        functionName: "approve" as const,
      };

      yield* writer.simulate(writeParams).pipe(
        Effect.mapError(
          (
            e
          ):
            | ApprovalError
            | ClientNotFoundError
            | InsufficientFundsError
            | ResourceExhaustionError
            | UserRejectedError => {
            if (
              e._tag === "ClientNotFoundError" ||
              e._tag === "InsufficientFundsError" ||
              e._tag === "ResourceExhaustionError" ||
              e._tag === "UserRejectedError"
            ) {
              return e;
            }
            return new ApprovalError({
              cause: e,
              message: `Approval simulation failed: ${String(e.message)}`,
              spender: params.spender,
              tokenAddress: params.tokenAddress,
            });
          }
        )
      );

      return yield* writer.write(writeParams);
    });

    const checkAllowance = Effect.fn("checkAllowance")(function* (params: CheckAllowanceParams) {
      const result = yield* reader
        .read({
          abi: erc20Abi,
          address: params.tokenAddress,
          args: [params.owner, params.spender] as const,
          chainId: params.chainId,
          functionName: "allowance",
        })
        .pipe(
          Effect.mapError((e): ApprovalCheckError | ClientNotFoundError => {
            if (e._tag === "ClientNotFoundError") {
              return e;
            }
            return new ApprovalCheckError({
              cause: e,
              message: `Failed to check allowance: ${String(e.message)}`,
              owner: params.owner,
              spender: params.spender,
              tokenAddress: params.tokenAddress,
            });
          })
        );

      return result as bigint;
    });

    const ensureAllowance = Effect.fn("ensureAllowance")(function* (params: EnsureAllowanceParams) {
      if (params.required <= 0n) {
        return { currentAllowance: 0n, status: "already-sufficient" } as const;
      }

      const currentAllowance = yield* checkAllowance({
        chainId: params.chainId,
        owner: params.account,
        spender: params.spender,
        tokenAddress: params.tokenAddress,
      });

      if (currentAllowance >= params.required) {
        return { currentAllowance, status: "already-sufficient" } as const;
      }

      const approveAmount = params.approveAmount ?? params.required;
      const zeroFirst = params.zeroFirst ?? true;

      const direct = approve({
        account: params.account,
        amount: approveAmount,
        chainId: params.chainId,
        spender: params.spender,
        tokenAddress: params.tokenAddress,
      }).pipe(Effect.either);

      const directResult = yield* direct;
      if (directResult._tag === "Right") {
        return {
          approveAmount,
          currentAllowance,
          hashes: [directResult.right],
          mode: "direct",
          status: "approved",
        } as const;
      }

      const failure = directResult.left;
      if (failure._tag !== "ApprovalError" || !zeroFirst || currentAllowance === 0n) {
        return yield* Effect.fail(failure);
      }

      const resetHash = yield* approve({
        account: params.account,
        amount: 0n,
        chainId: params.chainId,
        spender: params.spender,
        tokenAddress: params.tokenAddress,
      });

      const approveHash = yield* approve({
        account: params.account,
        amount: approveAmount,
        chainId: params.chainId,
        spender: params.spender,
        tokenAddress: params.tokenAddress,
      });

      return {
        approveAmount,
        currentAllowance,
        hashes: [resetHash, approveHash],
        mode: "zero-first",
        status: "approved",
      } as const;
    });

    return Erc20NoOutputAllowanceService.of({
      approve,

      checkAllowance,

      ensureAllowance,

      getMaxAmount: (_decimals: number) => maxUint256,
    });
  })
);
