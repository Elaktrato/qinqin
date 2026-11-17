# Translating qinqin

qinqin's interface is English today, but every string the web app shows comes from one message catalogue, so adding
a language is a new catalogue file and a human translation — no code changes. The rules are in
`docs/contracts/i18n/README.md`.

## Adding a language

1. Copy `apps/web/src/lib/i18n/messages/en.json` to `<lang>.json` (a BCP 47 tag: `de`, `zh-Hans`, `pt-BR`) and
   translate the values by hand. Keep every `{argument}`, every `<tag>…</tag>` and the plural structure
   (`{count, plural, one {…} other {…}}`, with the plural categories your language uses). `notes.json` explains
   keys whose context is not obvious. A key you leave out falls back to English.
2. Add the tag to `SUPPORTED_LANGUAGES` in `apps/web/src/lib/i18n/negotiate.ts`.
3. Run the catalogue test (`npx vitest run src/lib/i18n` in `apps/web`): it checks that every key exists in
   English with the same arguments and tags and that every plural has exactly your language's categories. The
   pseudo-locale test shows any text that is still hard-coded English.
4. Mails: copy `server/internal/mail/messages/en.json` to `<lang>.json` in the same folder and translate the
   subjects and bodies (`go test ./internal/mail` checks them).
5. Android: generate `values-<lang>/strings.xml` with the reference converter (from `apps/web`):
   `node scripts/i18n-android.mjs src/lib/i18n/messages/<lang>.json > values-<lang>/strings.xml`.

No machine bulk translation is ever committed: a translation is reviewed by someone who reads the language.
Product names, dictionary and pack names, licences and book data are never translated.
