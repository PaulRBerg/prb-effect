import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

/**
 * Note: These tests verify the navigation module's TypeScript types and structure.
 * Full runtime testing of navigation behavior requires a Next.js environment.
 * The Next.js navigation functions (redirect, permanentRedirect, notFound) throw
 * special errors that Next.js intercepts to perform navigation - we can't fully
 * test this behavior outside of a Next.js runtime.
 */

// Mock server-only
vi.mock("server-only", () => ({}));

// Mock React
vi.mock("react", () => ({
  default: {
    createContext: vi.fn(() => ({})),
    unstable_postpone: vi.fn(),
  },
}));

// Mock Next.js navigation functions - they throw but Next.js catches these
vi.mock("next/navigation.js", () => ({
  notFound: vi.fn(() => {
    const error = new Error("NEXT_NOT_FOUND");
    (error as { digest?: string }).digest = "NEXT_NOT_FOUND";
    throw error;
  }),
  permanentRedirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT");
    (error as { digest?: string }).digest = `NEXT_REDIRECT;replace;${url};308`;
    throw error;
  }),
  redirect: vi.fn((url: string) => {
    const error = new Error("NEXT_REDIRECT");
    (error as { digest?: string }).digest = `NEXT_REDIRECT;replace;${url}`;
    throw error;
  }),
}));

// Import after mocks
const { NotFound, NotFoundError, PermanentRedirect, Redirect, RedirectError } = await import(
  "./index.js"
);

describe("RedirectError", () => {
  it("is a tagged error class", () => {
    const error = new RedirectError({ type: "temporary", url: "/test" });
    expect(error._tag).toBe("RedirectError");
    expect(error.url).toBe("/test");
    expect(error.type).toBe("temporary");
  });

  it("can be permanent", () => {
    const error = new RedirectError({ type: "permanent", url: "/test" });
    expect(error.type).toBe("permanent");
  });
});

describe("NotFoundError", () => {
  it("is a tagged error class", () => {
    const error = new NotFoundError({});
    expect(error._tag).toBe("NotFoundError");
  });
});

describe("Redirect", () => {
  it("returns an Effect", () => {
    const effect = Redirect("/dashboard");
    // Verify it's an Effect (has pipe method)
    expect(typeof effect.pipe).toBe("function");
  });

  it("can be caught with catchTag", async () => {
    const effect = Redirect("/dashboard").pipe(
      Effect.catchTag("RedirectError", (error) => {
        expect(error).toBeInstanceOf(RedirectError);
        expect(error.url).toBe("/dashboard");
        expect(error.type).toBe("temporary");
        return Effect.succeed("caught-redirect");
      })
    );

    const result = await Effect.runPromise(effect);
    expect(result).toBe("caught-redirect");
  });
});

describe("PermanentRedirect", () => {
  it("returns an Effect", () => {
    const effect = PermanentRedirect("/new-url");
    expect(typeof effect.pipe).toBe("function");
  });

  it("can be caught with catchTag", async () => {
    const effect = PermanentRedirect("/archived").pipe(
      Effect.catchTag("RedirectError", (error) => {
        expect(error).toBeInstanceOf(RedirectError);
        expect(error.url).toBe("/archived");
        expect(error.type).toBe("permanent");
        return Effect.succeed("caught-permanent-redirect");
      })
    );

    const result = await Effect.runPromise(effect);
    expect(result).toBe("caught-permanent-redirect");
  });
});

describe("NotFound", () => {
  it("is an Effect", () => {
    expect(typeof NotFound.pipe).toBe("function");
  });

  it("can be caught with catchTag", async () => {
    const effect = NotFound.pipe(
      Effect.catchTag("NotFoundError", (error) => {
        expect(error).toBeInstanceOf(NotFoundError);
        return Effect.succeed("caught-not-found");
      })
    );

    const result = await Effect.runPromise(effect);
    expect(result).toBe("caught-not-found");
  });
});

describe("Error type composition", () => {
  it("RedirectError and NotFoundError can be composed", async () => {
    // Use instance types for union
    type NavigationError = InstanceType<typeof RedirectError> | InstanceType<typeof NotFoundError>;

    const fetchResource = (id: string): Effect.Effect<string, NavigationError, never> => {
      if (id === "moved") {
        return Redirect("/new-location");
      }
      if (id === "missing") {
        return NotFound;
      }
      return Effect.succeed("Resource data");
    };

    // Test successful case
    const successResult = await Effect.runPromise(fetchResource("test"));
    expect(successResult).toBe("Resource data");

    // Test redirect case
    const redirectResult = await Effect.runPromise(
      fetchResource("moved").pipe(
        Effect.catchTags({
          NotFoundError: () => Effect.succeed("Not found"),
          RedirectError: (error: InstanceType<typeof RedirectError>) =>
            Effect.succeed(`Redirect to ${error.url}`),
        })
      )
    );
    expect(redirectResult).toBe("Redirect to /new-location");

    // Test not found case
    const notFoundResult = await Effect.runPromise(
      fetchResource("missing").pipe(
        Effect.catchTags({
          NotFoundError: () => Effect.succeed("Not found"),
          RedirectError: (error: InstanceType<typeof RedirectError>) =>
            Effect.succeed(`Redirect to ${error.url}`),
        })
      )
    );
    expect(notFoundResult).toBe("Not found");
  });
});
