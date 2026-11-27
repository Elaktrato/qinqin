# Translating qinqin

qinqin's interface is English today, but every string the web app shows comes from one message catalogue, so adding a language is a new catalogue file and a human translation — no code changes. Each person chooses their language in Settings → Account (Language, Interface language; "Browser default" follows the browser), and each workspace may choose its own in Settings → Workspaces (Interface language; "Use my account setting" is the default); the server's mails follow the same settings. The exact rules are `docs/contracts/i18n/README.md`; this page is the translator's summary.

## Adding a language

1. Copy `apps/web/src/lib/i18n/messages/en.json` to `<lang>.json` (a language tag such as `de`, `zh-Hans`, `pt-BR`) and translate the values by hand. Keep every `{argument}`, every `<tag>…</tag>` and the plural structure (`{count, plural, one {…} other {…}}`, with the plural categories your language uses). `notes.json` in the same folder explains keys whose context is not obvious. A key you leave out falls back to English, key by key, so a half-translated language stays usable.
2. Nothing to register in code: the file is the registration. The list of interface languages is the catalogue files in that folder (`catalogueLanguages` in `apps/web/src/lib/i18n/negotiate.ts`), so the new language is negotiable and appears in both language settings (Account and Workspaces) once the file is there.
3. Run the catalogue test (`npx vitest run src/lib/i18n` in `apps/web`): it checks that every key exists in English with the same arguments and tags, that every plural has exactly your language's CLDR categories, and that no retired key is used. The pseudo-locale test shows any text that is still hard-coded English.
4. Mails: copy `server/internal/mail/messages/en.json` to `<lang>.json` in the same folder and translate the subjects and bodies (reset link, sign-in code, second-step code, address confirmation, test mail, address changed); `go test ./internal/mail` checks them. A subject never contains the code or the link.
5. Android: generate `values-<lang>/strings.xml` with the reference converter (from `apps/web`): `node scripts/i18n-android.mjs src/lib/i18n/messages/<lang>.json > values-<lang>/strings.xml`.

No machine bulk translation is ever committed: a translation is reviewed by someone who reads the language. Product names, dictionary and pack names, licences, attributions and book data are never translated.

## The message format

A small subset of ICU, so the web, Android and the Go mail formatter agree:

- `{name}` inserts an argument as written; numbers and dates arrive already formatted.
- A plural must be the **whole** message: `{count, plural, one {# card} other {# cards}}`, using any of `zero one two few many other` (`other` is required). `#` is the number in the locale's format. Text around a plural, `select`, `=N` exact matches and argument types are not supported: a "no items" state has its own key.
- `<tag>…</tag>` marks a span (a link, bold text); no attributes, no nesting, not inside a plural.
- `'` is a plain apostrophe. A literal `{`, `}`, `<` or `#` outside a plural branch is invalid.

Keys look like `area.part.name` and are **stable**: a key whose meaning changes gets a new name, and removed keys are listed in `docs/contracts/i18n/retired-keys.json`. API errors are shown from `apiError.<code>` keys, never from the server's English `message`.

## Which language a person sees

In a workspace that chooses its own interface language, that one; else the account's setting if there is one; else the browser's (or device's) languages in order; each candidate is matched exactly, then a `zh` without a script gets one (`zh-TW`, `zh-HK`, `zh-MO` → `zh-Hant`, every other `zh` → `zh-Hans`), then trailing parts are dropped (`pt-BR` → `pt`). No match means English. Dates and numbers use the interface language with the device's region; English without a region formats like `16 Nov 2026`. Mails use the recipient's setting, else the `Accept-Language` of the request that triggered them, else English; a reminder mail uses the language of the workspaces it counts when they share one (`docs/contracts/settings/interface-language.json`).

The setting is `PUT /api/me/interface-language` ([API reference](API-Reference#study-events-stats-and-features)).
