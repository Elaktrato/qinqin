# Interface text (`i18n/`)

Every user-visible client string comes from a message catalogue; a second interface language is a new catalogue
file plus a human translation, nothing else (issue #73). This folder is the rule every client (web, Android, the
Go server's mails) implements identically. Translations are written by people; no machine bulk translation is
ever committed. Status: the format, key scheme, syntax, negotiation and Android conversion are final; the
interface-language route and the server's mail catalogue are in place (below).

## Catalogue files

- One flat JSON object per language, keys sorted, values strings: `apps/web/src/lib/i18n/messages/<lang>.json`
  (`en.json` only today). The web catalogue is the source of truth for every client key; Android converts it
  (below) and keeps Android-only keys under `android.*` in its own file.
- Optional translator notes: `apps/web/src/lib/i18n/messages/notes.json` (`key → note`, English, never shown).
- The server's mails: `server/internal/mail/messages/<lang>.json`, same format, keys `mail.<kind>.subject` and
  `mail.<kind>.body` (`reset`, `loginCode`, `mfaCode`, `verifyEmail`, `test`, `emailChanged`), arguments `site`,
  `link`, `code`, `minutes`, `hours`; a subject never names `code` or `link`. A mail's language: the recipient's
  stored setting if set, else the triggering request's `Accept-Language` (by q-value), negotiated against the
  languages with a mail catalogue; `en` when nothing matches. The Go formatter (`server/internal/i18n`) decodes the
  same fixtures as the web.
- A key missing from a non-English catalogue falls back to `en` per key (a half-translated language stays
  usable). Every non-`en` key must exist in `en` with the same argument names, the same tags and the same
  plural-ness; its plural has exactly the categories `Intl.PluralRules(lang)` (CLDR) lists for the language.

## Keys

`area.part.name`: 2 to 6 segments joined by `.`, each `[a-z][a-zA-Z0-9]*` (lower camelCase, no `_`, no `-`),
at most 120 characters. The first segment is one of this closed list:

<!-- areas:start -->
`app`, `nav`, `common`, `auth`, `account`, `search`, `entry`, `study`, `flashcards`, `reader`, `journal`,
`grammar`, `stats`, `weekly`, `goals`, `notes`, `lookups`, `settings`, `admin`, `sources`, `packs`, `pwa`,
`widgets`, `plugin`, `apiError`, `format`, `features`, `milestones`
<!-- areas:end -->

- A key is **stable and never reused**. Changing a message's meaning means a new key; a removed key is appended
  to `retired-keys.json`, and no catalogue may contain a retired key.
- `common.*` holds only context-free UI words (`common.action.save`, `.cancel`, `.close`, `.delete`,
  `.retry`); every sentence or label with context has its own key even where the English text repeats.
- API errors: `apiError.<code in lower camelCase>` (`rate_limited` → `apiError.rateLimited`); built-in plugin
  manifest text: `plugin.<id in lower camelCase>.*`.

## Message syntax (an ICU subset)

A message is literal text with:

- `{name}`: an argument, `name` = `[a-z][a-zA-Z0-9]*`, inserted as a string. Callers pre-format numbers and
  dates for the locale; the formatter never formats a `{name}` argument.
- A plural: the **whole** message is `{name, plural, cat {…} …}` with any of the CLDR categories
  `zero one two few many other` (`other` required, each at most once). Inside a branch, `#` is the argument
  formatted with the locale's default number format (`Intl.NumberFormat(locale)`), and `{other}` arguments may
  appear. Whitespace between the plural's tokens is free; a branch's text is kept as written. The branch is the
  locale's CLDR category of the number; a category the message lacks falls to `other`.
- `<tag>…</tag>`: a rich-text span, `tag` = `[a-z][a-zA-Z0-9]*`, no attributes, no nesting, not inside a
  plural. The renderer decides what a tag is (a link, `<strong>`); plain-text output keeps the content.
- `'` is a literal apostrophe (no ICU quoting). A literal `{`, `}`, `<` or `#` outside a plural branch is
  invalid: pass it as an argument.

Not supported, each because Android has no one-to-one form: `select`, `=N` exact matches, nested or partial
plurals (text around a plural), argument types (`number`, `date`, …), `offset:`. A "no items" state gets its own
key. The error kinds are listed in `invalid-messages.json`.

Formatting: a missing argument (any argument the message names, in any branch) is an error (`missingArg`); the
web throws in development and tests and renders `{name}` in production. A plural argument must be a finite
number (`pluralNotNumber`).

## Android conversion

Reference implementation `apps/web/scripts/i18n-android.mjs` (`node scripts/i18n-android.mjs <lang.json>
[en.json] [notes.json]` prints `strings.xml`); fixture `android-convert.json`.

- Key → resource name: the segments joined by `_` (`settings.account.interfaceLanguage.label` →
  `settings_account_interfaceLanguage_label`); collision-free and reversible because segments have no `_`.
- Plain message → `<string name>`; plural → `<plurals name>` with one `<item quantity>` per category of the
  message, in its order. Keys are sorted.
- `#` and the plural argument → `%1$s` (the caller passes the formatted count as format argument 1 and the
  number as the quantity); other arguments take positions in order of first appearance in the **English**
  message (`{a}` → `%N$s`, after the count in a plural), identical for every language.
- Escaping: XML `&` `<` `>`; `'` `"` `\` with `\`; `%` → `%%` only in a string with arguments or a plural (one
  without arguments is read raw by `getString`); a leading `@` or `?` with `\`; a newline → `\n`; a leading or
  trailing space and a space after a space → ` ` (Android collapses whitespace).
- `<tag>…</tag>` → `<annotation tag="tag">…</annotation>`.
- A translator note → `<!-- note -->` above the item (`--` written `- -`).
- A key missing from the English catalogue is left out.

## Interface language

Resolution (fixture `negotiate.json`, implemented on the web, on Android and in Go): candidates = the stored
setting if non-empty, else `navigator.languages` (web), the device list (Android), or `Accept-Language` by
q-value (server). For each candidate in order: an exact match ignoring case in the supported list; then for a
`zh` candidate without a script the script is inserted (`zh-TW`, `zh-HK`, `zh-MO` → `zh-Hant`, every other `zh`
→ `zh-Hans`); then trailing subtags are dropped one at a time. First hit wins, spelled as the supported list
spells it; no hit → `en`. Today the supported list is `["en"]`.

Formatting locale (web and Android; `negotiate.json` `formatLocale`): dates and numbers use the interface
language plus the region of the first device language with the same primary subtag (`en` + `en-GB` → `en-GB`),
unless the interface language has its own region; else the interface language; a locale the platform cannot
resolve → `en`. Contract data (learner days, instants, row keys, payloads) is never localised.

The stored setting (`language-tags.json`): `''` (follow the browser/device) or a tag matching
`^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$`. The server validates syntax only, never support.

Route (`interface-language-api.json`): `GET /api/auth/me` carries `interfaceLanguage` (`''` until set);
`PUT /api/me/interface-language {language}` → `200 {language}`, 422 `invalid_language` for a value the pattern
refuses, 400 `bad_request` for a missing or non-string `language`. A full session only (401 anonymous, 403 for a
restricted session); personal access tokens are refused (403 `token_not_allowed`).

## Fixtures

| File | What | Decoded by |
| --- | --- | --- |
| `messages.json` | message, locale, args → output (and rich-text parts), formatter errors | web `lib/i18n/contract.test.ts`; Go (without parts) |
| `invalid-messages.json` | message → parse error kind | web `contract.test.ts`; Go |
| `plural-categories.json` | locale, integer → CLDR category (en, fr, ru, ar, ja) | web `contract.test.ts`; Go |
| `negotiate.json` | candidates, supported → language; `formatLocale` cases | web `contract.test.ts`; Go (`cases`) |
| `language-tags.json` | setting value → valid | web `contract.test.ts`; Go |
| `interface-language-api.json` | the setting route: request → status, body, `me` afterwards | Go `internal/api` |
| `android-convert.json` | catalogue (+ English, notes) → `strings.xml` | web `contract.test.ts` |
| `retired-keys.json` | keys no catalogue may contain | web `lib/i18n/catalogue.test.ts` |
