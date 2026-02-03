import { describe, expect, it } from "@effect/vitest";
import { arbitrum, mainnet, optimism } from "viem/chains";
import {
  makeRouteMeshTransports,
  ROUTEMESH_BASE_URL,
  routemeshRpc,
  routemeshToChainConfigs,
  routemeshUrl,
  routemeshWithFallback,
} from "@/src/presets/index.js";

describe("RouteMesh", () => {
  const TEST_API_KEY = "test-api-key-123";

  describe("routemeshUrl", () => {
    it("generates correct URL for mainnet", () => {
      const url = routemeshUrl(mainnet.id, TEST_API_KEY);
      expect(url).toBe(`${ROUTEMESH_BASE_URL}/${mainnet.id}/${TEST_API_KEY}`);
    });

    it("generates correct URL for arbitrum", () => {
      const url = routemeshUrl(arbitrum.id, TEST_API_KEY);
      expect(url).toBe(`${ROUTEMESH_BASE_URL}/${arbitrum.id}/${TEST_API_KEY}`);
    });

    it("handles different API keys", () => {
      const url1 = routemeshUrl(mainnet.id, "key-1");
      const url2 = routemeshUrl(mainnet.id, "key-2");
      expect(url1).toBe(`${ROUTEMESH_BASE_URL}/${mainnet.id}/key-1`);
      expect(url2).toBe(`${ROUTEMESH_BASE_URL}/${mainnet.id}/key-2`);
    });
  });

  describe("routemeshRpc", () => {
    it("returns a function that generates URL", () => {
      const mainnetRpc = routemeshRpc(mainnet.id);
      expect(typeof mainnetRpc).toBe("function");
      expect(mainnetRpc(TEST_API_KEY)).toBe(`${ROUTEMESH_BASE_URL}/${mainnet.id}/${TEST_API_KEY}`);
    });

    it("curried function is reusable", () => {
      const arbitrumRpc = routemeshRpc(arbitrum.id);
      expect(arbitrumRpc("key-a")).toBe(`${ROUTEMESH_BASE_URL}/${arbitrum.id}/key-a`);
      expect(arbitrumRpc("key-b")).toBe(`${ROUTEMESH_BASE_URL}/${arbitrum.id}/key-b`);
    });
  });

  describe("routemeshToChainConfigs", () => {
    it("converts single chain config", () => {
      const configs = routemeshToChainConfigs({
        apiKey: TEST_API_KEY,
        chains: [{ chain: mainnet, chainId: mainnet.id }],
      });

      expect(configs).toHaveLength(1);
      expect(configs[0]).toEqual({
        chain: mainnet,
        chainId: mainnet.id,
        rpcUrls: [`${ROUTEMESH_BASE_URL}/${mainnet.id}/${TEST_API_KEY}`],
      });
    });

    it("converts multiple chain configs", () => {
      const configs = routemeshToChainConfigs({
        apiKey: TEST_API_KEY,
        chains: [
          { chain: mainnet, chainId: mainnet.id },
          { chain: arbitrum, chainId: arbitrum.id },
          { chain: optimism, chainId: optimism.id },
        ],
      });

      expect(configs).toHaveLength(3);
      expect(configs[0].chainId).toBe(mainnet.id);
      expect(configs[0].rpcUrls[0]).toContain(`/${mainnet.id}/`);
      expect(configs[1].chainId).toBe(arbitrum.id);
      expect(configs[1].rpcUrls[0]).toContain(`/${arbitrum.id}/`);
      expect(configs[2].chainId).toBe(optimism.id);
      expect(configs[2].rpcUrls[0]).toContain(`/${optimism.id}/`);
    });

    it("preserves chain objects", () => {
      const configs = routemeshToChainConfigs({
        apiKey: TEST_API_KEY,
        chains: [{ chain: mainnet, chainId: mainnet.id }],
      });

      expect(configs[0].chain).toBe(mainnet);
    });

    it("handles empty chains array", () => {
      const configs = routemeshToChainConfigs({
        apiKey: TEST_API_KEY,
        chains: [],
      });

      expect(configs).toEqual([]);
    });
  });

  describe("routemeshWithFallback", () => {
    it("places RouteMesh URL first", () => {
      const urls = routemeshWithFallback(mainnet.id, TEST_API_KEY, ["https://fallback.com"]);

      expect(urls[0]).toBe(`${ROUTEMESH_BASE_URL}/${mainnet.id}/${TEST_API_KEY}`);
      expect(urls[1]).toBe("https://fallback.com");
    });

    it("handles multiple fallbacks", () => {
      const fallbacks = ["https://fallback1.com", "https://fallback2.com", "https://fallback3.com"];
      const urls = routemeshWithFallback(mainnet.id, TEST_API_KEY, fallbacks);

      expect(urls).toHaveLength(4);
      expect(urls[0]).toBe(`${ROUTEMESH_BASE_URL}/${mainnet.id}/${TEST_API_KEY}`);
      expect(urls.slice(1)).toEqual(fallbacks);
    });

    it("handles empty fallbacks", () => {
      const urls = routemeshWithFallback(mainnet.id, TEST_API_KEY, []);

      expect(urls).toHaveLength(1);
      expect(urls[0]).toBe(`${ROUTEMESH_BASE_URL}/${mainnet.id}/${TEST_API_KEY}`);
    });
  });

  describe("makeRouteMeshTransports", () => {
    it("creates transport map for single chain", () => {
      const transports = makeRouteMeshTransports(TEST_API_KEY, [
        { chain: mainnet, chainId: mainnet.id },
      ]);

      expect(transports[mainnet.id]).toBeDefined();
      expect(typeof transports[mainnet.id]).toBe("function"); // viem transports are functions
    });

    it("creates transport map for multiple chains", () => {
      const transports = makeRouteMeshTransports(TEST_API_KEY, [
        { chain: mainnet, chainId: mainnet.id },
        { chain: arbitrum, chainId: arbitrum.id },
        { chain: optimism, chainId: optimism.id },
      ]);

      expect(Object.keys(transports)).toHaveLength(3);
      expect(transports[mainnet.id]).toBeDefined();
      expect(transports[arbitrum.id]).toBeDefined();
      expect(transports[optimism.id]).toBeDefined();
    });

    it("creates transport with fallbacks", () => {
      const transports = makeRouteMeshTransports(TEST_API_KEY, [
        {
          chain: mainnet,
          chainId: mainnet.id,
          fallbackUrls: ["https://eth.llamarpc.com", "https://rpc.ankr.com/eth"],
        },
      ]);

      expect(transports[mainnet.id]).toBeDefined();
    });

    it("handles chains with and without fallbacks", () => {
      const transports = makeRouteMeshTransports(TEST_API_KEY, [
        {
          chain: mainnet,
          chainId: mainnet.id,
          fallbackUrls: ["https://fallback.com"],
        },
        { chain: arbitrum, chainId: arbitrum.id }, // no fallbacks
      ]);

      expect(transports[mainnet.id]).toBeDefined();
      expect(transports[arbitrum.id]).toBeDefined();
    });

    it("returns empty object for empty chains", () => {
      const transports = makeRouteMeshTransports(TEST_API_KEY, []);
      expect(transports).toEqual({});
    });
  });

  describe("ROUTEMESH_BASE_URL", () => {
    it("has correct base URL", () => {
      expect(ROUTEMESH_BASE_URL).toBe("https://lb.routeme.sh/rpc");
    });
  });
});
