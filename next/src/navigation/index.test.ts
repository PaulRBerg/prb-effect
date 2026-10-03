import { describe, expect, it } from "@effect/vitest";
import { Effect } from "effect";
import { vi } from "vitest";

vi.mock("server-only", () => ({}));

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
