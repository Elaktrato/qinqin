# Contract changelog

Changes to the shared rules in `docs/contracts/`, newest first. One entry per change that a client must
follow (a removed route form, a new or retired fixture, a changed answer); typo fixes and rewording are not
logged. Earlier changes: the error catalogue's own changelog in [`auth/README.md`](auth/README.md#changelog)
(#168).

## #220 — topic labels of words (contract 22)

- **New folder `topics/`:** the fixed topic list shared by every language (`topics.json`, rule `topics/list`: 49 ids
  with an English scope; names are the messages `topics.name.<id>`), decoded by Go and web; the labels file a server
  embeds and the lookup of a listed word's topics (`labels.json`, rule `topics/labels`), decoded by Go.
- **i18n:** a new key area `topics`.
- **Clients:** no route changes. The labels are read by the server (the course fill rule, #221); a client shows a
  topic by its id's name and ignores an id it does not know.

## #300 — tone sandhi: spoken tones on tone cards (contract 21)

- **New contract `tones/`** (shared with the tone-pair drill #180): citation tones (the dictionary's) and spoken
  tones (tone sandhi: 不 before a 4th tone is 2; 一 is 2 before a 4th tone and 4 before tones 1–3, and stays 1 alone,
  at the end, before a neutral tone, after 第/初 and next to a numeral; a 3rd tone before a 3rd tone is 2, right to
  left, by word boundaries). New fixture `tones/sandhi.json` (rule `tones/sandhi`: the spoken tones of each case and
  the tone card's verdict), decoded by web and Go.
- **Grading of a tone answer:** each syllable is right with its citation **or** its spoken tone (before: citation
  only); with the setting `tones.gradeSpoken` the spoken tone only. The verdict also reports the reading's spoken
  tones.
- **New workspace-settings key** `tones` (`settings/README.md`): `{"showSandhi": boolean, "gradeSpoken": boolean}`,
  defaults `true` and `false`, read member by member, written one member at a time by merge patch. New fixture
  `settings/tones.json` (rule `settings/tones`). `showSandhi: false` never shows a spoken tone.
- **Clients:** no route or stored data changes. A client that does not know the key grades citation tones only.

## #163 — the mastery map's grading (contract 20)

- **New workspace-settings key** `masteryMap` (`settings/README.md`): `{grading, includeOutside, levels}`: one
  grading per workspace (a built-in grouping or `pack:<packId>`), whether characters outside it are shown, and the
  study set of each pack's levels by `ord`. New fixture `settings/mastery-map.json` (rule `settings/mastery-map`:
  parse, the grading a language resolves to with its default and fallback, the study set, the patches), decoded by web
  and Go; a new merge case in `settings/workspace-settings.json`.
- **Clients:** no route changes. A client that does not know the key shows the map as before.

## #295 — Stats is a core feature (contract 19)

- **Features:** a sixth core feature id `stats` (`features/switches.json`: `features` and the GET order end in
  `stats`; a new PUT case). `PUT /api/features/stats` stores the switch; no migration (since 055 the table has no list
  of ids). The README lists what a client hides while Stats is off and what stays.
- **Widgets:** `activity-heatmap`, `character-map-summary`, `summary-numbers` and `reviews-per-day` are Stats'
  widgets now (owner `stats`), and `word-states` (flashcards') needs Stats on too. The widget catalogue of
  `settings/core-rows.json` is in the new registry order (core, then the features'); the ids are unchanged, so a
  stored `home-layout` keeps working.
- **Clients:** a client that does not know `stats` ignores its row (the list is read leniently) and keeps showing
  Stats.

## #297 — the interface language per workspace (contract 18)

- **New workspace-settings key** `interfaceLanguage` (`settings/README.md`): a language tag, absent = "use my account
  setting" (`null` clears it). New fixture `settings/interface-language.json` (rule `settings/interface-language`),
  decoded by web and Go: reading the key, the setting that applies (workspace, else account, else the browser's
  languages) and the setting of a reminder mail about several workspaces (theirs when they agree, else the account's).
- **Reminder mails** follow that rule; every other mail keeps the account's setting.
- **Clients:** no route changes. A client that does not know the key uses the account setting everywhere, as before.

## #287 — the writing card's automatic stroke hints are counted (contract 17)

- **Writing, `meta.hints`:** after 3 misses on one stroke the client shows that stroke only (a glow, then the stroke
  dimmed with its start until it is drawn), no longer the whole character's outline, and again for any later stroke
  that reaches 3 misses. Each such automatic hint counts as one stroke hint in the review's `meta.hints`, beside the
  presses of the stroke-hint button and the shown characters (`cards/README.md`, "Recording"). The suggested grade is
  unchanged (the card's own help does not lower it). Before: at most one automatic hint per character, and it left
  the outline on screen. No fixture changes.

## #284 — hidden romanisation (contract 16)

- **New workspace-settings key** `romanisation` (`settings/README.md`): `{"pinyin" | "bopomofo" | "romaji": "always" |
  "never"}`, default `always`, read member by member; written one type at a time by merge patch. New fixture
  `settings/romanisation.json` (rule `settings/romanisation`), decoded by web and Go: the rule `isReadingShown`, a plain
  reading string typed by its script, and the switches of each language.
- **Language profiles:** a new member `romanisations` (`zh`: `pinyin`, `bopomofo`; `ja`: `romaji`; others none).
- **Hints:** a new last hint kind `romanisation` (`cards/hints.json`): the hidden readings of the entry, offered only
  when the entry has one, never stored (its mode follows the `reading` kind: `never` stays `never`, else `hint`); the
  `reading` kind offers only the readings that are shown. An entry is now `{hasReading, hasPicture, hasRomanisation}`.
- **Clients:** no route or stored data changes. A client that does not know the key shows every reading, as before.
## #290 — Serving held rows while a round runs (no contract number)
- **Sync notes:** "Serving held rows" in [`sync/README.md`](sync/README.md#serving-held-rows-290): a client answers
  display reads at once from the rows it holds and refreshes them with a background delta round; a first load, an
  explicit refresh, a full round, rows marked stale and a write's planning read wait. A failed background round
  keeps the held rows with a quiet notice. A client rule only: no route, payload or fixture changes, so the
  ContractVersion stays.

## #277 — Grammar lesson runs are study events (contract 15)

- **New event type:** `grammar`, one per finished lesson run, `{point: "<packId>:<lessonId>", mode: "lesson",
  score, total}` (member order pinned), written through `POST /api/events/batch` like a review. New fixture
  `grammar/runs.json` (rule `grammar/runs`: the payload, which events are runs, the progress replay, the conversion of
  old progress rows); `events/payloads.json` gains its `build` case. `mode` leaves room for grammar review (#181); a
  client ignores a mode it does not know.
- **Removed routes and table:** `GET /api/grammar/progress` and `POST /api/grammar/progress` are gone (404), and so
  is the table `grammar_progress`; no compatibility layer. A client replays the progress (best score, last run, runs)
  from the workspace's `grammar` events. Retired fixture: `grammar/progress.json`.
- **Migration 056:** each `grammar_progress` row becomes one `grammar` event (its best score at its `completedAt`, or
  its write time; device `migration`); a row the rules refuse is dropped. Then the table is dropped.
- **Backups:** an export carries the runs as events and writes no `grammar:progress:` rows; a restore of an older
  archive turns each such row into the same event (device `restore`), counted under `restored.rows` (the dry run
  agrees, and now also drops a row that does not convert).
- **Activity:** a new core rule `grammar` (feature `grammar`, `distinctBy: "point"`): 1 point per lesson finished, once
  per lesson per learner day; the activity route lists it as a source (`events/activity.json`), so a daily goal can be
  `activity:grammar` and the weekly summary shows it.
- **EXP and streak:** 20 EXP per lesson run (`scheduler/xp.json` `lessonRunXp`; the daily bonus stays a review bonus);
  a learner day with a run counts for the streak (`scheduler/streak.json` `lessons`), in Stats, the weekly summary and
  the milestones' `streak` and `days-active` families (`milestones/reached.json`).

## #288 — companion eligibility decided when a session is planned (contract 14)

- **New route:** `POST /api/study/eligibility {"ids": [...]}` (1 to 500 entry ids) answers, per entry, the companion
  kinds a study session can make of it for the caller: `sentence`, `writing`, `tone`, `reverse`, `cloze`, in kind order
  (`{"entries": {"<id>": [...]}}`, an unknown entry `[]`). Signed-in users only, no access tokens, not cached offline.
- **New fixture** `cards/eligibility.json` (rule `cards/eligibility`), decoded by Go and web: the show-time rules of
  the cards (a non-blank sentence; a Han character with stroke data in an installed pack; a cloze blank among the
  first 8 sentences, inflected forms counted through the segmenter; clean toned pinyin in a tonal language; a word
  with a gloss) moved to planning.
- **Planning:** a companion is planned only when the index allows it (an unknown entry as before). The web client's per-tab memory of ineligible words (`qinqin.study.ineligible` in sessionStorage) is gone.

## #62 — Japanese stroke order: the language of a stroke request (contract 13)

- **New query parameter:** `GET /hanzi/U<HEX>.json?lang=<code>` (two or three lower-case letters) asks for the shapes
  of one language where the installed strokes packs differ: a pack that lists the language comes first, then the pack
  with the fewest languages (a pack made for Japanese alone beats the shared Chinese-and-Japanese one), then the order of
  registration. A character only one pack has is served whatever the language; a malformed `lang` is `400 bad_request`;
  without it nothing changes. New fixture `strokes/lookup.json` (rule `strokes/lookup`) and `strokes/README.md`.
- **Clients:** the web app passes the language of the entry or workspace and keys its stroke cache by language and
  character; the service worker's `/hanzi/` cache keeps a well-formed `lang` in its key (the one query parameter it keeps).
- **New pack, no new type or route:** `kanjivg-strokes` (KanjiVG, CC BY-SA 3.0, languages `["ja"]`, built by
  `scripts/fetch-kanjivg-strokes.sh`, shipped beside the binary and never in it or in the web build). It carries kana,
  Japanese kanji forms and the iteration marks in the stroke-data format the app already reads; kana have stroke data
  for the first time, so the writing pad works on them. `GET /api/stroke-packs` lists it with the others.

## Tatoeba credits on every sentence (contract 12)

- **Sentence pack file (`sentences.json`):** each sentence carries its own credit: `id` (its Tatoeba id), `by` (its
  owner as Tatoeba lists it, left out when none), `tid` (the id of the translation shown with it, required with an `id`)
  and `tby` (the translation's owner, left out when none). The separate top-level `credits` map is gone: a pack that
  still has it is refused at import, and so is a sentence with a credit but no `id`. A sentence listed under several
  words repeats its credit. The link of a credit is not stored: it is `https://tatoeba.org/en/sentences/show/<id>`.
- **Sentences data package (`sentences.<packId>`): format 2.** The `sentences` table gains `credit_id`, `credit_owner`,
  `credit_tr_id` and `credit_tr_owner` (all `NOT NULL`; `0` and `""` for a sentence without a credit). Format 1 is not
  read: a server rebuilds its sentences packages at the next reconcile, a client that knows only format 1 gets
  `unsupported` from `packageAction` for them and keeps what it has. The other package types stay format 1;
  `schemas.json` states a type's own `formatVersion` when it differs. No client installs data packages yet.
- **Unchanged:** the entry answer's `credit` object, the stored columns (migration 054) and the pack licence notices.

## Owner rulings on hints and tone aids (contract 11)

- **Changed rule:** the hint grade rule of `cards/hints.json` (`grades`): a hint asked for with the Hint control
  lowers the suggested grade **one step** (Easy to Good, Good to Hard; Hard and Again stay; a self-graded card counts
  as Good and becomes Hard), once however many hints were used. It used to cap at Hard. Clients implement the new
  table; stored reviews are not rewritten (`cards/README.md` "Hints").
- **Changed setting:** the `visualAids` member `toneContour` (boolean, default `true`), new beside `toneColors`:
  colours and contour are separate switches. A stored `toneColors: false` without a stored `toneContour` reads as
  contour off too (they used to be one switch). Older clients ignore the new member and keep it on write
  (`aids/visual-aids.json`, `aids/README.md`, `settings/`).

## #214 — Starter mode: per-word stages and Starter sets (contract 10)

- **New fixtures:** `starter/stages.json` (rule `starter/stages`): the stage of a word derived from its vocab card's
  own reviews (a success counts one point at least twelve hours after the last counted review, Hard pauses, Again drops
  one stage, per-profile thresholds `ja` 0,1,2,3,5,7 and `zh` 0,1,2,4,6, words usually written in kana stop at stage 4),
  what the front shows at each stage and the hint modes it forces; and `starter/set.json` (rule `starter/set`): the
  Starter set file format. Chinese stage 4 forces the reading hint to `hint` (it announced "no pinyin" while a
  `reading: always` setting still showed it). Clients that show Starter mode implement the rule the same way (`starter/README.md`).
- **New routes:** `GET /api/starter-sets` (public, not access tokens) and `GET /api/starter-sets/{id}` (signed-in users,
  not access tokens): the shipped sets, and one set's words resolved to dictionary entries in the set's order. Neither
  is cached offline by the service worker beyond the default (`routes.fixture.json`).
- **Workspace setting:** the key `starter`, `{enabled, scope}`, read member by member with the defaults off and `base`
  (`settings/workspace-settings.json` key table). Older clients ignore it and keep it on write.
- **Deck id:** the Starter set is copied into the plain deck `d-starter-<ja|zh>` (no `source`, so no deck row shape
  changes); `decks/README.md` lists the id.
- **Catalogue keys:** `flashcards.starter.new.*`, `flashcards.starterSet.*`, `app.home.starter*`, `settings.starter.*`;
  the picture is #212's Picture hint (gated by the `visualAids.pictures` switch); Starter mode only forces its mode.

## #212 — visual aids: pictures, tone colours, character anatomy (contract 9)

- **Workspace setting:** the key `visualAids`, `{pictures, toneColors, anatomy}` booleans, all on by default, read
  switch by switch (`settings/workspace-settings.json` key table). Older clients ignore it and keep it on write.
- **New fixtures:** `aids/visual-aids.json` (rule `aids/visual-aids`: the key, the defaults, how it is read and
  written), `aids/tones.json` (rule `aids/tones`: the syllable split of a pinyin reading, the five tone contours,
  the Okabe-Ito based colour set and how it is made readable on a theme) and `aids/anatomy.json` (rule
  `aids/anatomy`: parts of a character from the components index with meanings from the character universe). The
  rules are in `aids/README.md`.
- **Hints:** the `picture` kind of `cards/hints.json` is ready: an entry offers it when `hasPicture` (an images pack
  maps it and `pictures` is on). Defaults and plans are unchanged.
- **No new route, row or pack type.** A client that draws none of these changes nothing; a client that does reads
  `GET /api/images/entries/{id}`, `GET /api/components` and `GET /api/characters` as before.
- **Catalogue keys:** `settings` gains `settings.aids.*`, `study` gains `study.aids.*`; `settings.hints.kind.pictureNote`
  now describes the ready picture hint.

## #216 — images packs: bundled pictures for words (contract 8)

- **New pack type:** `images` (format `images-svg`, `languages` like a strokes pack, uploadable, no data package),
  last in `packages/pack-types.json` (`type`, `registry` `image_packs`, `languages: "many"`, `package: null`). A
  client that lists packs meets the type in the admin list and the Sources page only.
- **New routes:** `GET /api/images/entries/{id}[?sense=N]` (signed-in users, not access tokens): the best bundled
  picture of an entry as `{"picture": {packId, concept, label, credit, license, attribution, basis, sense, score,
  svg}}` or `{"picture": null}`; and `GET /api/image-packs` (public, not access tokens): the installed packs for the
  Sources page. Neither is cached offline by the service worker (`routes.fixture.json`).
- **New fixtures:** `images/resolve.json` (rule `images/resolve`: which mapping wins for an entry, sense and
  targets) and `images/svg.json` (rule `images/svg`: the picture vocabulary, what a client must refuse, and
  `themeSvg`). The pack format and the licence position (BY-SA data in its own packs, never compiled in or bundled
  in the web build) are in `images/README.md`.
- **Clients** that do not draw pictures change nothing. A client that does calls `GET /api/images/entries/{id}`
  (web: `entryPicture`), refuses active content in the svg (`safeSvg`), draws black outlines in the text colour
  (`themeSvg`) and shows the credit (`pictureCreditLine`).
- **Amendment (v0.8.0 review, stored XSS; no contract renumbering, nothing of it was released):** the server stores
  and serves the picture's *canonical form* (`images/README.md`, "Pictures are drawings"), no longer the pack's bytes:
  a comment, `style` element, unknown element or attribute, a non-`#id` reference, an escaped `url(` and nested
  `<use>` are refused. `images/svg.json` is version 2: each valid case carries its `canonical` form (Go and web must
  produce it byte for byte) and the payloads of the review are invalid cases. A client draws created DOM nodes
  (`svgElement`), never `{@html}`.

## #215 — hints on every flashcard (contract 7)

- **New fixture:** `cards/hints.json` (rule `cards/hints`): the hint kinds (`reading`, then `picture`, a registry in
  a fixed order), the three modes (`always`, `hint`, `never`), the defaults per card kind, how the setting is read,
  the plan of one card, and the grade rule: a hint asked for with the Hint control lowers the suggested grade to
  Hard (Again stays Again; a self-graded card is suggested Hard), once, however many hints were used. Clients
  implement the plan, the rule and the recording the same way (`cards/README.md` "Hints").
- **Workspace setting:** the key `hints`, `{<kind>: {<card kind>: <mode>}}`, read cell by cell with defaults
  (`settings/workspace-settings.json` key table). Older clients ignore it and keep it on write.
- **Review event:** `meta.hints` now also counts the hints asked for with the Hint control (`events/README.md`);
  the shape is unchanged.
- **Behaviour change:** the Recall card's "Show reading" is the reading hint; its suggestion (Hard after a right
  answer with the reading shown) is now the general rule. The message `flashcards.card.showReading` is retired
  (`i18n/retired-keys.json`); the writing card's stroke button reads "Next stroke hint" (key
  `flashcards.writing.strokeHint`, replacing `flashcards.writing.hint`).
- **Catalogue keys:** the area `flashcards` gains `flashcards.hint.*`; `settings` gains `settings.hints.*`.

## #204, #63 — writing-system trainer (scripts) (contract 6)

- **Feature switch:** a fifth core feature id `scripts`, last in the order (`features/switches.json`:
  `features`, the fresh list). `GET /api/features` answers five rows; clients keep reading a missing row as on.
- **Event type:** `script`, written by the web app, one per practice answer: `{system, item, mode, ok}`
  (`events/payloads.json`, builder `scriptPayload`). The server stores it like any event; payload ids need no
  remapping on restore.
- **Activity rule:** `script` is a count rule of the feature `scripts` (`events/activity.json`: `rules`, a case), so
  every answer is a heatmap, goal and weekly-summary activity. `GET /api/stats/activity` lists it among the sources.
- **Language profiles:** the new member `writingSystems` (a list of ids, empty for no trainer) on every profile, and
  new profiles `ko` (`hangul`) and `ru` (`cyrillic`) (`languages/profiles.json`; `ko` resolved to the fallback
  before). Readers that ignore unknown members are unaffected.
- **Catalogue keys:** the key area `scripts` (`i18n/README.md`).

## #74 — "I already know this": declaration batches on known marks (contract 5)

No route, key family or fixture file changes. The reader's manual mark `known:<entryId>` (`reader/`) may now
carry three optional fields: `batch` (a ULID), `source` (`range` | `placement`) and `scope` (a label, at most
120 code points). A declaration ("everything up to HSK 3", a placement result) writes one such mark per entry
that has no live mark, all with the same `batch`; undoing it tombstones exactly the live marks still carrying
that batch. Clients that do not know the fields ignore them, keep them on rewrite and restore (the backup remap
keeps the other bytes), and treat the mark as any other. `reader/word-states.json` gains `rowCases` for the
fields. The placement test itself is client-side (pure, seeded) and has no contract.

## #36 — native device features advertised on the bridge (contract 4)

- **Bridge:** `GET /api/version` now answers `bridge: {level: 1, features: ["files", "haptics", "keep-awake",
  "local-notifications", "share", "status-bar", "tts"]}`. The level stays 1: every new piece is optional (the web
  app also runs in a browser). A shell without one of them gets the "missing in this app" warning only. The
  Android shell advertises all of them (`SHELL_BRIDGE`, `apps/android/src/firstrun/verify.ts`).
  `bridge-compat.json` is unchanged; `version.json` follows. `local-notifications` is groundwork: the reminders
  (#137-#139) use it through the device port.
- **Settings:** the workspace-settings key `gradeHaptics` (boolean, default on): the buzz when a card is graded
  (`settings/workspace-settings.json`: `keys` and `parse`). Readers ignore unknown keys, so older clients are
  unaffected.

## #137, #138, #139 — study reminders, email nudges and web push (contract 3)

- **Settings row:** new user-global keyed row `reminders` (`keyed/families.json`; parse rules and fixture
  `reminders/settings.json`): master switch (off by default), kinds, up to three local times, quiet hours (wrap
  midnight), and the channels `email`, `push`, `device`. Clients keep unknown keys.
- **Routes:** `PUT /api/reminders/facts` (the client's derived due/goal/streak/vacation snapshot per workspace; the
  server has no scheduler), `GET /api/reminders/plan?days=N` (the planned reminder slots: kind, instant, local time,
  count; the shell schedules local notifications from it; fixture `reminders/plan.json`), `POST /api/reminders/test`,
  `GET /api/push/vapid-key`, `GET|POST /api/push/subscriptions`, `DELETE /api/push/subscriptions/{id}`, and the public
  `GET|POST /api/reminders/unsubscribe?t=` (signed token, fixture `reminders/unsubscribe.json`). No access tokens.
- **Error codes:** `push_unavailable`, `no_subscription`, `too_many_subscriptions`, `delivery_failed`
  (`auth/errors.json`).
- **Email:** reminder mails carry `List-Unsubscribe` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click`.
- **Version:** `version/version.json` answers `contract: 3` (then 4 with #36).

## Study modal — the saved study setup (contract 2)

- **Keyed rows:** new workspace family `study-setup` (exact key; `keyed/families.json`, three new cases). A
  user-global row of it is 400 `bad_request` on the key routes and refused alone in a push.
- **Study setup:** the row is the setup the study modal starts, saved per workspace and synced
  (`study/setup.json`, new fixture, rule `study/setup`): `{version: 1, decks: "all" | [deck id], mode, schemeId,
  levelName, cardTypes, unchecked, newLimit, reviewLimit, newOrder, typeOrder}`, read member by member, repaired
  member by member, unknown members kept on write. It replaces the web's per-tab setup and the browser keys
  `qinqin.study.cardTypes` and `qinqin.study.extraTypes`, which are no longer read or written.

## Stage 1 review — the bridge names `status-bar` (contract 2)

- **Bridge:** `GET /api/version` now answers `bridge: {level: 1, features: ["status-bar"]}` (was `[]`): the web
  app sends the theme's chrome colour to the shell's `setBars` when the shell has it (`lib/native/bars.ts`). A
  shell without `status-bar` now gets the "missing in this app" warning. `version/version.json` follows;
  `bridge-compat.json` is unchanged.

## #35 — review outbox v3 (no contract bump)

- **Outbox:** the web client's review queue moves from `localStorage` (`qinqin.study.pending.v2`) to an IndexedDB
  store with one record per review, written before the POST and committed before a review counts as saved
  (`pwa/README.md` "Outbox v3"). The item, the event, the ownership and the flush rules are unchanged, and no route
  or answer changes, so the contract version stays 1: storage is the web client's own, and a second client only has to
  keep the binding semantics, which did not change. The fixture `pwa/outbox-v2.json` is renamed `outbox-v3.json` and
  gains `migration` and `order` cases. Event writes time out after 20 s on the web.

## #154 — version, bridge and release check (contract 1)

- **Contract version:** the answer of `GET /api/version` carries `contract`, an integer that starts at 1 with this
  entry and goes up by one in each change that adds an entry a client must follow (`version/README.md`). Entries
  before this one count as contract 0.
- **Routes:** new `GET /api/version` (public: `{app: "qinqin", version, contract, bridge: {level, features}}`;
  with a full session also `commit` and `buildDate`; `Cache-Control: no-store`), and the administrator routes `GET
  /api/admin/update`, `PATCH /api/admin/update/settings`, `POST /api/admin/update/check`, no access token
  (`version/version.json`, `version/update-check.json`, new fixtures).
- **Native shell:** the compatibility rule between the server's `bridge` and the shell's own is the fixture
  `version/bridge-compat.json` (web: `bridgeCompatibility`).

## #211 — bootstrap administrator by default

- **Registration:** `POST /api/auth/register` no longer makes the first user on an empty instance the
  administrator; an instance with no users answers 403 `registration_closed` whatever its mode (an invite
  included). The server creates the first administrator before it listens.
- **Options:** `GET /api/auth/options` no longer has `bootstrap` (`auth/options.json`: the `bootstrap` case is
  gone).

## #189 — profile pictures

- **Profile pictures:** new routes `POST /api/account/avatar` (multipart field `file`; JPEG, PNG or WebP, 5 MB,
  25 megapixels and 8192 px a side, not animated; 200 `{avatarUrl}`), `DELETE /api/account/avatar`, `GET
  /api/avatars/{user}/{hash}[?size=64]` (any signed-in user; `private, no-cache`) and `DELETE
  /api/admin/users/{id}/avatar` (audited `avatar_removed`), no access token (`auth/avatar.json`, new fixture). `GET
  /api/auth/me` and the administrator user object carry `avatarUrl` (string or null; `auth/me.json`,
  `auth/admin-users.json`); the deletion previews count `avatar`. New error code `animated_image` (415);
  `photo_too_large`, `unsupported_image` and `image_too_large` now also answer the picture upload.
- **Backups:** a personal archive may hold `account/avatar.jpg` with the manifest count `avatar`; the server backup
  holds `avatars/` (`backup/README.md`).
- **auth/README.md** no longer names a Kotlin client: the Android app is the web app in a Capacitor shell.
- **Fix wave:** the picture upload also caps the decoded bytes (100 MiB, so 12.5 megapixels for a 16-bit picture;
  `image_too_large`), and an upload whose account was deleted or disabled meanwhile is 401 with nothing stored.

## #186 — AI example sentences on demand

- **AI examples:** new routes `GET/POST /api/entries/{id}/examples` (the caller's drafts; one AI call with the
  learner's own key, `{level, requestId}`, idempotent by `requestId`), `POST
  /api/entries/{id}/examples/{draftId}/keep`, `DELETE /api/entries/{id}/examples/{draftId}[?reason=]` and `DELETE
  /api/entries/{id}/sentences/{sentenceId}[?reason=]` (a kept AI example only), no access token
  (`examples/README.md`). New fixture `examples/examples.json`, new error code `examples_full` (409).
- **Sentences:** every sentence (the entry answer's `sentences`, the pull's `sentences` rows, the keep answer) has
  `ai`: `{provider, model}` for a kept AI example, else `null` (`sync/pull-page.json` shapes and rows). A backup
  line of `sentences/` carries `ai` for an AI example (optional member). The deletion previews count
  `exampleReports` (`auth/admin-users.json`).
- **Fix wave:** `GET …/examples` adds `lastRequest` and a generation's answer `requestId`; a generation that kept
  nothing is stored as a marker (answered on a retry) and leaves the earlier drafts. Readings must be in the reading
  system's letters. A kana-only segmenter match of a word written with Han counts only when the entry is its first
  candidate, for the AI examples and the cloze card alike (`cards/cloze.json`, two new cases). The backup's `ai` has
  `level` and a restore applies the live rules (`examples/README.md`).

## #185 — the conversation partner

- **Journal conversations:** new routes `GET/POST /api/journal/conversations`, `GET/DELETE
  /api/journal/conversations/{id}`, `POST /api/journal/conversations/{id}/turn` (one AI call with the learner's own
  key) and `POST /api/journal/conversations/{id}/save` (the conversation becomes an entry), all `?workspace=`,
  no access token (`journal/README.md#conversations`). New fixture: `journal/conversations.json`. New error codes
  `conversation_full` and `conversation_limit` (409). A backup carries each conversation as
  `journal:conversation:<id>`; the deletion previews count `journalConversations` (`auth/admin-users.json`).
- **Fix wave:** a turn takes `{text, turnId}` (required) and a message carries `turnId`; a retry with a stored id
  answers the stored turn. New error code `wrong_language` (422) for a reply not mostly in the workspace language.
  The transcript quotes every partner line and escapes a learner line starting with `>`
  (`journal/conversations.json` `transcripts`, replacing `transcript`).

## #199 — core features instead of code plugins

- **Journal:** entries, reviews, topic ideas and settings are typed storage with their own routes
  (`GET /api/journal/entries`, `GET/PUT/DELETE /api/journal/entries/{id}`, `GET
  /api/journal/entries/{id}/review`, `GET /api/journal/suggestions`, `GET/PUT /api/journal/settings`;
  `journal/README.md`). New fixture: `journal/entries.json`. The `qinqin-journal` plugin rows (`entry:`,
  `review:`, `suggestions`, `settings`) are gone; a backup carries the documents as `journal:entry:<id>`,
  `journal:review:<entryId>`, `journal:suggestions`, `journal:settings`. The deletion previews count
  `journalEntries`.
- **Grammar:** lesson progress is typed storage: `GET /api/grammar/progress?workspace=` lists it, `POST
  /api/grammar/progress?workspace= {packId, lessonId, score, total}` records a run; the server keeps the best
  score (`grammar/README.md`). New fixture: `grammar/progress.json`. The `qinqin-grammar` plugin rows
  (`lesson:<packId>:<lessonId>`) are gone; a backup carries the rows as `grammar:progress:<packId>:<lessonId>`.
- **Keyed rows replace plugin data:** the core's remaining rows (notes, lookups, known marks, milestones, goals,
  vacations, the home layout, the activity view, the widget options, the navigation layout, the appearance)
  live in one store without a namespace (`keyed/README.md`, new fixture `keyed/families.json`) that accepts
  only the listed key families, each in its scope. Routes: `GET /api/rows`, `GET/PUT/DELETE /api/rows/{key}`
  replace `/api/plugins/{id}/data[/{key}]` (removed). Pull collection `rows` replaces `pluginData`; the push
  member `rows` replaces `pluginData`; the row shape drops `pluginId`. A pushed row of an unknown family or in
  the wrong scope is refused alone (`dataRefused`); on the key routes an unknown key is 404 `not_found`, the
  wrong scope 400. Fixtures changed: `sync/pull-page.json`, `sync/pull-rounds.json`, `sync/push-result.json`,
  `sync/unreadable-rows.json`, `backup/remap.json` (op `row`), `settings/*.json` and `themes/appearance.json`
  (no `pluginId`), `auth/admin-users.json` (deletion preview `keyedRows`).
- **Language profiles:** new fixture `languages/profiles.json` (zh, ja, es and the fallback): what a language
  has (script, readings, segmentation, tones, strokes, kana, variants, card kinds, practice modes), resolved by
  the primary subtag. Availability checks follow it; a regional tag such as `zh-TW` now gets everything `zh`
  has (word counts, the variant label, the journal's Han check), and a language without writing or tone cards
  no longer lists them in the study setup.
- **Feature switches replace plugin states; the code plugins are retired:** `GET /api/features` lists the
  caller's switch of the four core features (`flashcards`, `reader`, `journal`, `grammar`; no row is on), `PUT
  /api/features/{id} {enabled}` stores one (`features/README.md`, new fixture `features/switches.json`). Removed:
  `GET /api/plugins`, `PUT /api/plugins/{id}/state`, the admin registry route `POST /api/admin/plugins`,
  every plugin id (`qinqin-core`, `qinqin-flashcards`, `qinqin-reader`,
  `qinqin-journal`, `qinqin-grammar`) and the plugin manifest format. The pull collection `features` (`{id,
  enabled, updatedAt}`) replaces `pluginStates`; a backup's `account.json` carries `features: [{id,
  enabled}]`. The web's study pull no longer asks for the switches.
- **Activity sources:** `GET /api/stats/activity` `sources` are `{type, feature, unit}` (no `plugin`, `label`
  or `describe`: a client words a source from its catalogue, `activity.source.<type>.*`); `events/activity.json`
  `rules` name the `feature`. The `plugin.*` catalogue keys are retired (`i18n/retired-keys.json`).
- **Deck sources:** the variant `{type:"plugin", pluginId, key}` is gone (`study/rows.json` now refuses it,
  `decks/system-deck-ids.json` drops the `d-plg-` case); migration 047 turns such a deck into a plain deck. The
  legacy codec keeps an old plugin source in `extra` (`backup/study-rows.json`). The flashcards route
  `system/plugin/...` is gone.
- **Error catalogue:** `plugin_no_data` leaves `auth/errors.json` (nothing sends it).
- **Backup format 2:** the family `plugin-data` becomes `rows` (no `pluginId`); typed study rows, journal
  documents and grammar progress travel there in their keyed form. A format 1 archive is refused
  (`backup_version_unsupported`; `backup/reject.json`). The dry-run report drops `pluginsNotInstalled`; its
  counts say `rows` for `pluginData`. The sample archive is `backup/sample-v2/`.

## #192 — one pack system on the server

No fixture changes; `packages/pack-types.json` is unchanged and still decoded by the Go and web tests. Two
answers can differ:

- **`GET /api/admin/packs`:** re-importing an unchanged components, audio or font pack (a re-seed, the same
  upload again) no longer changes its `updatedAt`, as for the other types already; nothing is rewritten.
- **`pack_invalid` detail:** a manifest that breaks two own-format rules at once (for example a lemma-rules
  pack with the format `themes-json`) now names the rule of its own type. Every other validation message is
  unchanged.

## #198 — the v0.3 compatibility layer is removed

v0.3.x clients are no longer supported.

- **Sync:** a pull without `v=2` (the legacy streaming form, `cursor=`) answers 404 `not_found`. The paged
  pull never ships a `qinqin-flashcards` row of a typed family in `pluginData`. A push item of `pluginData`
  with such a key is refused alone (`dataRefused`). Retired: `sync/legacy-pull.json`;
  `sync/push-result.json` replaces its two legacy cases with the refusal.
- **Typed study rows:** the legacy view is gone. `GET`, `PUT` and `DELETE
  /api/plugins/qinqin-flashcards/data/{key}` of a typed-family key (`card:`, `deck:`, `deckcfg:`,
  `limits:workspace`, `limits:deck:`, `fsrs:set:`, `fsrs:active`) answer 404 `not_found`, and a prefix list
  leaves such keys out. Retired: `study/legacy-view.json`. The error code `study_row_invalid` leaves
  `auth/errors.json` (nothing sends it).
- **Backups:** the keyed form of the typed rows is now only the backup format's; old-format archives (a
  v0.3.0 server's) still restore. A leftover `plugin_data` row of a typed family is never exported (a
  readable unshadowed one was), and the server no longer takes such rows over at start. `study/legacy-codec.json` moved to `backup/study-rows.json` (rule
  `backup/study-rows`, same cases).
- **Plugins and packs:** `GET /api/plugins` lists registry plugins only (no synthesized row per data pack,
  #169); a data pack's id is an unknown plugin for `PUT /api/plugins/{id}/state`, the data routes and a push.
  `packages/pack-types.json` drops its `legacyPluginRow` column. `GET /api/admin/packs` no longer lists
  sentences without a registry row (a pre-v0.2.0 import); `language_in_use` still counts them as
  `legacySentences` (own sentences, `source_pack = ''`, no longer count) and its message names each such
  pack with its removal route `DELETE /api/admin/sentences/{pack}`.
- **Web storage:** the v0.3.x review queue `qinqin.study.pending` is neither read nor removed;
  `pwa/outbox-v2.json` drops its `legacy` member and the adoption case. A pull without `v=2` is never cached
  by the service worker.
- **Scheduler:** `scheduler/limits-rows.json` drops its keyed-row `rows` cases and `scheduler/fsrs.json` its
  `paramSet` cases (the keyed `limits:*` and `fsrs:set:*` parsers went with the layer); the typed rows are
  pinned by `study/rows.json`.
