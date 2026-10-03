import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { TEST_ADDRESS, TEST_CHAIN_ID } from "#src/testing-kit/index.js";
import { fetchNftMetadata } from "./metadata.js";

const params = { address: TEST_ADDRESS, chainId: TEST_CHAIN_ID, tokenId: 1n };

describe("fetchNftMetadata", () => {
  it.effect("decodes UTF-8 JSON from base64 and percent-encoded data URIs", () =>
    Effect.gen(function* () {
      const metadata = { name: "猫" };
      const json = JSON.stringify(metadata);
      const base64 = btoa(String.fromCharCode(...new TextEncoder().encode(json)));
      for (const uri of [
        `data:application/json;base64,${base64}`,
        `data:application/json,${encodeURIComponent(json)}`,
      ]) {
        expect(yield* fetchNftMetadata(uri, params)).toEqual(metadata);
      }
    })
  );

  it.effect("maps malformed data URI payloads to the metadata error channel", () =>
    Effect.gen(function* () {
      for (const uri of [
        "data:application/json,{",
        "data:application/json,%E0%A4%A",
        "data:application/json;base64,ew==",
      ]) {
        const error = yield* fetchNftMetadata(uri, params).pipe(Effect.flip);
        expect(error._tag).toBe("Erc721MetadataFetchError");
        expect(error.uri).toBe(uri);
      }
    })
  );
});
