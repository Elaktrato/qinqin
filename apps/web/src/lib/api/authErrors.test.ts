import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/client";
import { authErrorMessage, waitText } from "./authErrors";

const json = (error: string, message: string) =>
  JSON.stringify({ error, message });

describe("waitText", () => {
  it.each([
    [1, "1 second"],
    [6, "6 seconds"],
    [59, "59 seconds"],
    [60, "1 minute"],
    [61, "2 minutes"],
    [900, "15 minutes"],
    [0.2, "1 second"],
  ])("%s s", (s, want) => expect(waitText(s)).toBe(want));
});

describe("authErrorMessage", () => {
  it("maps bad_credentials", () => {
    expect(
      authErrorMessage(new ApiError(401, json("bad_credentials", "x")), "f"),
    ).toBe("Wrong username or password.");
  });
  it("words 429 from Retry-After", () => {
    expect(
      authErrorMessage(
        new ApiError(429, json("rate_limited", "server text"), 6),
        "f",
      ),
    ).toBe("Too many sign-in attempts. Try again in 6 seconds.");
    expect(
      authErrorMessage(new ApiError(429, json("rate_limited", "m"), 900), "f"),
    ).toBe("Too many sign-in attempts. Try again in 15 minutes.");
    expect(
      authErrorMessage(new ApiError(429, json("rate_limited", "m"), 60), "f"),
    ).toContain("1 minute.");
  });
  it("words a registration 429 generically", () => {
    expect(
      authErrorMessage(
        new ApiError(
          429,
          json("rate_limited", "Too many attempts. Try again in 6 seconds."),
          6,
        ),
        "f",
      ),
    ).toBe("Too many attempts. Try again in 6 seconds.");
  });
  it("uses the body message without Retry-After", () => {
    expect(
      authErrorMessage(
        new ApiError(429, json("rate_limited", "Try later.")),
        "f",
      ),
    ).toBe("Try later.");
  });
  it("shows the message of busy and unknown codes", () => {
    expect(
      authErrorMessage(
        new ApiError(503, json("busy", "The server is busy."), 2),
        "f",
      ),
    ).toBe("The server is busy.");
    expect(
      authErrorMessage(
        new ApiError(400, json("bad_request", "Bad body.")),
        "f",
      ),
    ).toBe("Bad body.");
  });
  it("maps register codes", () => {
    expect(
      authErrorMessage(new ApiError(409, json("username_taken", "x")), "f"),
    ).toContain("taken");
    expect(
      authErrorMessage(new ApiError(403, json("admin_required", "x")), "f"),
    ).toContain("administrator");
  });
  it("keeps the old behaviour for plain-text bodies", () => {
    expect(authErrorMessage(new ApiError(401, "bad credentials\n"), "f")).toBe(
      "Wrong username or password.",
    );
    expect(
      authErrorMessage(new ApiError(409, "username taken\n"), "f"),
    ).toContain("taken");
    expect(
      authErrorMessage(new ApiError(403, "admin token required\n"), "f"),
    ).toContain("administrator");
    expect(authErrorMessage(new ApiError(500, "internal error\n"), "f")).toBe(
      "internal error\n",
    );
    expect(authErrorMessage(new Error("network down"), "f")).toBe(
      "network down",
    );
    expect(authErrorMessage("weird", "Login failed.")).toBe("Login failed.");
  });
});
