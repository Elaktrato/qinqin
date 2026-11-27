# Interface text (`i18n/`)

Every user-visible client string comes from a message catalogue; a second interface language is a new catalogue
file plus a human translation, nothing else (issue #73). This folder is the rule every client (web, Android, the
Go server's mails) implements identically. Translations are written by people; no machine bulk translation is
ever committed. Status: final — the format, key scheme, syntax, negotiation, Android conversion, the
interface-language route, the server's mail catalogue, `lang` attributes, locale formatting, API errors by code
and built-in manifest text (below).

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
`widgets`, `activity`, `apiError`, `format`, `features`, `milestones`, `scripts`
<!-- areas:end -->

- A key is **stable and never reused**. Changing a message's meaning means a new key; a removed key is appended
  to `retired-keys.json`, and no catalogue may contain a retired key.
- `common.*` holds only context-free UI words (`common.action.save`, `.cancel`, `.close`, `.delete`,
  `.retry`); every sentence or label with context has its own key even where the English text repeats.
- API errors: `apiError.<code in lower camelCase>` (`rate_limited` → `apiError.rateLimited`); the activity
  sources: `activity.source.<type>.*`.

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

Resolution (fixture `negotiate.json`, implemented on the web, on Android and in Go): candidates = the setting that
applies if non-empty (the workspace's own, else the account's: `settings/interface-language.json`, #297), else `navigator.languages` (web), the device list (Android), or `Accept-Language` by
q-value (server). For each candidate in order: an exact match ignoring case in the supported list; then for a
`zh` candidate without a script the script is inserted (`zh-TW`, `zh-HK`, `zh-MO` → `zh-Hant`, every other `zh`
→ `zh-Hans`); then trailing subtags are dropped one at a time. First hit wins, spelled as the supported list
spells it; no hit → `en`. The supported list is the catalogues that exist: on the web every
`messages/<tag>.json` (`catalogueLanguages`), `en` first; today `["en"]`.

Formatting locale (web and Android; `negotiate.json` `formatLocale`): dates and numbers use the interface
language plus the region of the first device language with the same primary subtag (`en` + `en-GB` → `en-GB`),
unless the interface language has its own region; else the interface language — except English without a region,
which formats as `en-GB` (day before month, 24-hour times: the English the interface has always written; a device
set to `en-US` still gets `en-US`); a locale the platform cannot resolve → `en-GB`. Contract data (learner days, instants, row keys, payloads) is never localised.

The stored setting (`language-tags.json`): `''` (follow the browser/device) or a tag matching
`^[a-z]{2,3}(-[A-Z][a-z]{3})?(-([A-Z]{2}|[0-9]{3}))?$`. The server validates syntax only, never support.

Route (`interface-language-api.json`): `GET /api/auth/me` carries `interfaceLanguage` (`''` until set);
`PUT /api/me/interface-language {language}` → `200 {language}`, 422 `invalid_language` for a value the pattern
refuses, 400 `bad_request` for a missing or non-string `language`. A full session only (401 anonymous, 403 for a
restricted session); personal access tokens are refused (403 `token_not_allowed`).

## `lang` and `dir` attributes

- `<html lang>` is the resolved interface language, set before the app mounts (web: the root layout's `load`),
  with `dir="rtl"` for `ar`, `fa`, `he`, `ur` (`ltr` otherwise). Interface text never carries a `lang` of its own.
- Study text always carries the study language (the workspace's, a book's or a pack's): web
  `apps/web/src/lib/i18n/lang.ts` — `studyLang(language, {variant})` (a bare `zh` reads as `zh-Hans`; a converted
  reader/grammar variant names its script; the stored language for the original), `readingLang(type, language)`
  (pinyin `zh-Latn-pinyin`, bopomofo `zh-Bopo`, kana/on/kun `ja`, romaji `ja-Latn`), `glossLang` (a dictionary's
  gloss language, `en` by default). A reading shown with an interface label ("Pinyin: hàn") tags only the value.
- The only literal `lang` in web markup is the footer's brand hanzi (`lang="zh"`, the product name); a lint fails on
  any other.

## Locale formatting

Dates, times, numbers, percentages, relative times, lists, durations and language names shown to a person are
formatted in the formatting locale (above: the interface language plus the device region; English without a
region formats as `en-GB`). Learner days (`YYYY-MM-DD`) are formatted at UTC midnight so no zone shifts them.
Contract data — learner days, instants, row keys, file names, payloads — is never localised. Web:
`apps/web/src/lib/i18n/format.ts`; a lint fails on `Intl.*Format(`/`toLocale*String(` outside it (three
allowlisted machinery files: the study-day rule, zone canonicalisation, the device zone).

## API errors

The API's `message` stays an English sentence for developers and logs. Clients show text from their catalogue by
the `error` code: `apiError.<code camelCased>` for every code of `docs/contracts/auth/errors.json` (which also
lists the AI and journal photo codes), with context wording where a screen needs it; a code the client does not
know shows a generic text (web `apiError.unknown`, naming the code) or the screen's own fallback — never
`message`. Every API error carries a code (#168): there is no uncoded text answer left to translate.

## Activity sources

The code plugins are retired (#199): there are no manifests to translate. The activity sources of the core table
(`server/internal/stats/rules.go`, `docs/contracts/events/activity.json`) are worded by the client alone:
`activity.source.<type>.label` and `activity.source.<type>.count` (one whole-message plural with `{n}`; web
`lib/activity/sources.ts`). The `plugin.*` keys are retired. Pack names, licences, attributions and book metadata
are data and never translated.

## Rulings

Copied from the design (`docs/superpowers/specs/2026-11-16-v040p-i18n-design.md`), with the build's additions:

- Ruling: in-house formatter on `Intl.PluralRules`/`NumberFormat`/`DateTimeFormat`, no i18n dependency — the needed syntax is small, a library's richer syntax would be the part Android cannot share, and nothing new ships under a third-party licence — cost if wrong: we maintain ~300 lines (parser, formatter, negotiation, converter) and their fixtures; switching to a library later means converting syntax.
- Ruling: no Sources-page credit is added because no i18n code ships; `thirdPartyLicenses.test.ts` stays unchanged and the Sources page gains no row — cost if wrong: none (if a library is adopted later, its credit and licence test are added then).
- Ruling: one file per language, not per feature — a translator (and the Android converter) works on one file; per-feature files multiply by languages and break lazy loading of a language into many requests; sorted keys keep merge conflicts local — cost if wrong: a big `en.json` (~150 kB raw, ~35 kB gzip) in the main bundle; splitting later is a mechanical move because keys are already namespaced.
- Ruling: the web catalogue is the source of truth for every client key; Android converts `en.json` (and later languages) with the documented converter and adds Android-only keys under `android.*` in its own file — cost if wrong: Android-only strings live elsewhere; acceptable, they have no web meaning.
- Ruling: segments are camelCase without `_` so the Android name `segments.join('_')` (`settings_account_interfaceLanguage_label`, a valid resource name) is collision-free and reversible — cost if wrong: none found; a key that needs a digit-leading segment cannot exist.
- Ruling: a key is **stable and never reused**: changing a message's meaning means a new key; a removed key is appended to `docs/contracts/i18n/retired-keys.json` and a test fails if a catalogue key is retired — so a stale Android or translation file can never show a wrong sentence — cost if wrong: a slowly growing retired list.
- Ruling: `common.*` holds only context-free UI words (`common.action.save`, `.cancel`, `.close`, `.delete`, `.retry`); every sentence or label with context gets its own key even if the English text repeats — languages differ where English does not — cost if wrong: duplicate English values (a test does not flag duplicates).
- Ruling: no `select`, no `=N` exact matches, no nested or partial plurals, no number/date argument types — each has no one-to-one Android form (`<plurals>` must be the whole string and has no exact matches; `zero` is a CLDR category, not "0"); "no items" states get their own key — cost if wrong: a few more keys and call-site `if`s than full ICU.
- Ruling: plain apostrophes, not ICU quoting — English UI copy is full of "don't"/"isn't" and ICU's doubling rule is the classic source of broken strings; the converter escapes for Android — cost if wrong: a message can never show a literal `{` (none does today).
- Ruling: a missing key in a non-English catalogue falls back to `en` per key (dev/test log a warning); a missing argument throws in dev and tests and renders `{name}` in production — a half-translated language is still usable, tests catch real mistakes — cost if wrong: mixed-language screens while a translation is incomplete (the catalogue test reports coverage per language).
- Ruling: `t` is a plain function, not a store, and changing the interface language reloads the page — language changes are rare, and a store would make every string reactive and every component subscribe — cost if wrong: one reload on change (the PWA shell is cached, so it is fast).
- Ruling: that reload is guarded so it can never loop or sign anyone out — the web reloads only when the localStorage mirror reads back the new language, when that language's installed catalogue (not just the negotiated tag) differs from the running one, and at most once per start (a sessionStorage marker); with blocked storage it does not reload and Settings says the page keeps its language — cost if wrong: on a browser that blocks site storage the interface language never changes there (mails and other devices still follow the setting).
- Ruling: argument names are not type-generated; the catalogue test checks every literal call site `t('k', { … })` it can parse against the message's arguments, and a missing argument throws in tests — no build step — cost if wrong: an unparsed dynamic call site is checked only at runtime.
- Ruling: dynamic keys (`t(\`x.${y}\`)`) are forbidden by a lint; enumerations use typed maps (`Record<SettingsTab, MessageKey>`), so every key appears as a literal and the unused-key check stays exact — cost if wrong: a few more lines per enumeration.
- Ruling: extraction does not reword anything, even awkward copy — the diff must be reviewable as a move; rewording is a separate commit with its own test change — cost if wrong: known-awkward English survives into the catalogue (translators can ask).
- Ruling: hand-rolled plurals become catalogue plurals in the same area commit (that changes only generated text where the old code was wrong, e.g. "1 hour" cases); each such case gets a unit test — cost if wrong: small, the tests pin it.
- Ruling: heuristic lint with an explicit allowlist, not an AST analysis — catches the common case (a literal in markup) at near-zero cost; the allowlist is reviewed in diffs — cost if wrong: an odd construct (a string in a `{#if}` ternary in markup, `{'Text'}`) escapes; the TS rule and the pseudo- locale test below cover part of it.
- Ruling: a test-only pseudo-locale (`en-XA`: every message wrapped and accented) renders a sample of page components and asserts no plain ASCII English text node remains — it finds concatenation and missed strings the heuristic cannot; it is generated in the test, never shipped (not a translation) — cost if wrong: maintenance of the sample list.
- Ruling: a server-side user setting, not a sync row — the server must know it for mails sent before sign-in (reset, sign-in code), a sync row is workspace data the server does not interpret; Android reads it from `me` like every account setting — cost if wrong: one migration, one route.
- Ruling: the server validates syntax only, not support — a newer Android with more languages can store its choice and the web falls back per the negotiation rule — cost if wrong: a stored tag no client supports behaves like `''` plus the user's chosen base language where possible.
- Ruling: `noTok` — a script has no reason to change the interface language — cost if wrong: none.
- Ruling: a small written algorithm in both languages instead of x/text `language.Matcher` or a browser API — three clients must agree exactly and fixtures can pin a 15-line rule, not a matcher's distance tables — cost if wrong: weaker matches for exotic tags (`nb` vs `no`), fixable by aliases.
- Ruling: keep the device region for formatting — an English UI user in Germany or Britain expects their own date order; the server stores only the language — cost if wrong: two devices of one user may format dates differently (correct for each device).
- Ruling: the footer's brand hanzi keeps the fixed `lang="zh"` and is the only literal `lang` left in markup (allowlisted with that reason) — it is the product's name (勤勤 is the same in both scripts), not study text, so it must not follow a Japanese workspace — cost if wrong: none.
- Ruling: a lint (in `hardcoded.test.ts`) fails on any literal `lang="…"` attribute in non-test markup outside the allowlist, which catches `CardManager`'s and `ToneCard`'s `lang="zh"` — cost if wrong: one allowlist line per deliberate exception.
- Ruling: learner-authored text (notes, journal) carries the language the feature records (journal entry language) or none (notes: free text, inherits the interface) — guessing a language from content would mislabel mixed notes — cost if wrong: a Chinese note read in the interface voice.
- Ruling: contract data never goes through these helpers — `YYYY-MM-DD` learner days, RFC 3339 instants, row keys, export file names and API payloads stay in their fixed formats; only text shown to a person is localised — cost if wrong: none; the Intl lint keeps `studyDay.ts`/`zoneSettings.ts`'s fixed locales as allowlisted machinery.
- Ruling: the API `message` stays an English sentence for developers and logs; clients show text from their catalogue by `error` code (`apiError.<code camelCased>`), with context overrides where wording differs (`auth.login.error.rateLimited`); `authErrors.ts` stops reading and parsing `message`; an unknown code (newer server) shows `apiError.unknown` ("Something went wrong ({code}).") — clients already must branch on codes, and a server cannot know the client's catalogue — cost if wrong: a new server code shows the generic text until the client adds a key (a test pins that every code in `auth/errors.json` and the area READMEs has a key). Adaptation: that includes item 4's `study_row_invalid` and item 5's `sync_collection_moved`, `sync_page_invalid`, `sync_cursor_expired`, `package_not_found`, `package_revision_gone`, `download_busy` (429, "another package download is running").
- Ruling: `Error`s a client throws for developers (`sync/pager.ts` "a page does not match the contract", `maxPages`) stay English and are never shown; the UI shows a catalogue text for "sync failed" instead, and a user-facing client error (`PartialPushError` "rows were not written …") becomes a catalogue plural — the lint's `Error`-argument exemption must therefore not hide user-facing texts: an `Error` whose `message` is rendered (`errorMessage(err, …)`) is extracted — cost if wrong: an English developer message could reach the screen; the pseudo-locale sample of each area catches it.
- Ruling: mails are localised by the user's language: stored setting if set, else the triggering request's `Accept-Language`, else `en`, negotiated against the languages present in `server/internal/mail/messages/`; subjects and bodies move into that catalogue (`mail.reset.subject`, `mail.reset.body`, …) in the shared syntax, formatted by a small Go implementation of the same subset (plural categories from `golang.org/x/text/feature/plural`, already a dependency, BSD-3) and checked against the same fixtures — mails reach people who cannot read English, and one syntax for both sides keeps translators on one format — cost if wrong: a Go formatter to keep in step with TS (fixtures pin both). The "within 1 hour" plural is fixed by the catalogue plural.
- Ruling: plugin manifests: built-in plugins' `name`, `description` and activity `label`/`describe` are looked up as `plugin.<id camelCased>.*` with the manifest text as fallback; third-party manifest text is shown verbatim (no translation, no `lang` override) and manifest localisation is a follow-up (sdk 2) — the sdk 1 contract cannot change in this item — cost if wrong: third-party plugins stay English. (Superseded by #199: the plugins and their manifests are gone; see "Activity sources".)
- Ruling: pack names, licence text, attribution and book metadata are data, never translated; they keep the `lang` the data declares (`cjkLang`) — cost if wrong: none.
- Ruling: `manifest.webmanifest` stays English (one static file) — cost if wrong: an English install name on a non-English device; revisit with a second language.
- Ruling: plural fixtures are limited to integers where CLDR versions agree (0–25, 100, 101, 1000000) and to the six locales above; a locale where Node's ICU and x/text disagree is dropped and recorded — cost if wrong: thinner cross-implementation coverage.
- Ruling (build): English without a device region formats as `en-GB` (day before month, 24-hour times: the English
  the interface has always written); a device set to `en-US` keeps `en-US` — cost if wrong: a bare-`en` browser
  sees "16 Nov 2026".
- Ruling (build): the AI and journal photo codes the server emits are in `auth/errors.json`, so every client
  translates them by code like the auth codes — cost if wrong: the server's specifics (a model name, a language)
  are not shown.

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
