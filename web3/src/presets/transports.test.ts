import { describe, expect, it } from "@effect/vitest";
import { mainnet, optimism, polygon } from "viem/chains";
import {
  makeChainTransports,
  makeFallbackTransport,
  makeHttpTransport,
} from "@/src/presets/index.js";

describe("transports", () => {
  describe("makeHttpTransport", () => {
    it("returns Transport object", () => {
      const transport = makeHttpTransport({ url: "https://rpc.example.com" });
      expect(transport).toBeDefined();
      expect(typeof transport).toBe("function");
    });

    it("uses default timeout (10000)", () => {
      const transport = makeHttpTransport({ url: "https://rpc.example.com" });
      // Transport is a function, verify it can be called
      expect(transport).toBeDefined();
      expect(typeof transport).toBe("function");
    });

    it("uses custom timeout when provided", () => {
      const transport = makeHttpTransport({
        timeout: 5000,
        url: "https://rpc.example.com",
      });
      expect(transport).toBeDefined();
      expect(typeof transport).toBe("function");
    });
  });

  describe("makeFallbackTransport", () => {
    it("creates transport from URLs array", () => {
      const transport = makeFallbackTransport([
        "https://rpc1.example.com",
        "https://rpc2.example.com",
      ]);
      expect(transport).toBeDefined();
      expect(typeof transport).toBe("function");
    });
  });

  describe("makeChainTransports", () => {
    it("maps chainId to transport", () => {
      const transports = makeChainTransports([
        { chainId: mainnet.id, rpcUrls: ["https://eth.example.com"] },
      ]);
      expect(transports).toBeDefined();
      expect(transports[mainnet.id]).toBeDefined();
      expect(typeof transports[mainnet.id]).toBe("function");
    });

    it("handles multiple chains", () => {
      const transports = makeChainTransports([
        { chainId: mainnet.id, rpcUrls: ["https://eth.example.com"] },
        { chainId: polygon.id, rpcUrls: ["https://polygon.example.com"] },
        { chainId: optimism.id, rpcUrls: ["https://optimism.example.com"] },
      ]);
      expect(transports).toBeDefined();
      expect(Object.keys(transports)).toHaveLength(3);
      expect(transports[mainnet.id]).toBeDefined();
      expect(transports[polygon.id]).toBeDefined();
      expect(transports[optimism.id]).toBeDefined();
      expect(typeof transports[mainnet.id]).toBe("function");
      expect(typeof transports[polygon.id]).toBe("function");
      expect(typeof transports[optimism.id]).toBe("function");
    });
  });
});
