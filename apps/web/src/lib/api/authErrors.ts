import { ApiError, apiErrorBody } from "$lib/api/client";
import { t } from "$lib/i18n";
import { apiErrorText, errorText } from "./apiErrors";

/** Which form asks: sign-in says "sign-in attempts", the others "attempts" (rate_limited wording). */
export type AuthErrorContext = "signIn" | "register" | "reset";

/** "6 seconds", "1 minute", "15 minutes": whole units, rounded up like the server. */
export function waitText(seconds: number): string {
  const s = Math.max(1, Math.ceil(seconds));
  return s < 60
    ? t("format.duration.seconds", { count: s })
    : t("format.duration.minutes", { count: Math.ceil(s / 60) });
}

/**
 * The text a sign-in, registration or reset failure shows: the catalogue text of the server's `error` code
 * (never its English `message`), with the wait from Retry-After for rate_limited, worded for the caller's
 * form. An uncoded body falls back to the status; anything else shows `fallback` or a UserError's text, never an
 * English message (#168).
 */
export function authErrorMessage(
  err: unknown,
  fallback: string,
  context: AuthErrorContext = "signIn",
): string {
  const body = apiErrorBody(err);
  if (body) {
    if (body.error === "admin_required") return t("auth.error.adminRequired");
    if (
      body.error === "rate_limited" &&
      err instanceof ApiError &&
      err.retryAfterSeconds !== undefined
    ) {
      const wait = waitText(err.retryAfterSeconds);
      return context === "signIn"
        ? t("auth.error.rateLimitedSignIn", { wait })
        : t("auth.error.rateLimitedOther", { wait });
    }
    return apiErrorText(body.error);
  }
  if (err instanceof ApiError) {
    if (err.status === 401) return apiErrorText("bad_credentials");
    if (err.status === 409) return apiErrorText("username_taken");
    if (err.status === 403) return t("auth.error.adminRequired");
  }
  return errorText(err, fallback);
}
