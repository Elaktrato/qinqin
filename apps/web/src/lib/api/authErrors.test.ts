import { describe, expect, it } from "vitest";
import { ApiError } from "$lib/api/client";
import { authErrorMessage, waitText } from "./authErrors";
import { UserError } from "./userError";

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
  it("words account_disabled", () => {
    expect(
      authErrorMessage(new ApiError(403, json("account_disabled", "x")), "f"),
    ).toBe("This account is disabled. Ask an administrator to enable it.");
  });
  it("words a weak password from the catalogue, not the server's sentence", () => {
    expect(
      authErrorMessage(
        new ApiError(422, json("weak_password", "Use at least 10 characters.")),
        "f",
      ),
    ).toBe(
      "This password is not allowed: use 10 to 256 characters, and not your username.",
    );
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
  it("words a registration 429 generically (the caller's context)", () => {
    expect(
      authErrorMessage(
        new ApiError(
          429,
          json("rate_limited", "Too many attempts. Try again in 6 seconds."),
          6,
        ),
        "f",
        "register",
      ),
    ).toBe("Too many attempts. Try again in 6 seconds.");
  });
  it("words a 429 without Retry-After from the catalogue", () => {
    expect(
      authErrorMessage(
        new ApiError(429, json("rate_limited", "Try later.")),
        "f",
      ),
    ).toBe("Too many attempts. Try again later.");
  });
  it("words busy and other codes from the catalogue", () => {
    expect(
      authErrorMessage(
        new ApiError(503, json("busy", "The server is busy."), 2),
        "f",
      ),
    ).toBe("The server is busy. Try again in a moment.");
    expect(
      authErrorMessage(
        new ApiError(400, json("bad_request", "Bad body.")),
        "f",
      ),
    ).toBe("The request was not understood. Reload the page and try again.");
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
    // Never the server's or an Error's own text (#168): the fallback, or a UserError's catalogue text.
    expect(authErrorMessage(new ApiError(500, "internal error\n"), "f")).toBe("f");
    expect(authErrorMessage(new Error("network down"), "f")).toBe("f");
    expect(
      authErrorMessage(new UserError("auth.error.secondStepNeeded"), "f"),
    ).toBe("This account needs a second step: use the sign-in page.");
    expect(authErrorMessage("weird", "Login failed.")).toBe("Login failed.");
  });
});

describe('registration errors', () => {
	const sentence = (code: string) => authErrorMessage(new ApiError(403, json(code, 'x')), 'f');
	it('words every registration code', () => {
		expect(sentence('registration_closed')).toContain('Registration is closed');
		expect(sentence('invite_invalid')).toBe('This invite link is no longer valid.');
		expect(sentence('email_required')).toBe('An email address is required.');
		expect(sentence('email_taken')).toBe('That email address is already in use.');
		expect(sentence('token_invalid')).toContain('not valid any more');
	});
});
