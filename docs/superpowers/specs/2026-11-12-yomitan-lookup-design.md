# Yomitan-style Lookup — Design

Date: 2026-11-12
Status: Implemented 2026-11-13 on feature/yomitan-lookup
Builds on: `docs/superpowers/specs/2026-11-12-reader-design.md` (the reader plugin, the core tokenizer, JMdict reading-based matching and `uk`/priority ranking). This work starts from the tip of `feature/reader` on its own branch, `feature/yomitan-lookup`.

## Intent

Make dictionary lookup in the reader behave like Yomitan's: hovering a word shows a ranked, **stacked list of entries** instead of one guessed entry, with frequency data, part-of-speech-aware deinflection, "show more", and **popups that open from inside popups**. Today the reader resolves a word to a single best entry and has no way to recover from a wrong first guess (for example `した` in `宿題をした` resolves to 下 instead of 為る, and a deinflected candidate like 話する can win by accident). Yomitan avoids this by (a) showing every plausible entry in a well-chosen order, (b) gating deinflection by part of speech, and (c) ranking with corpus frequency. We adopt the same approach.

## Goals

- A lookup returns an **ordered list of entries**, grouped by term + reading, each with: the matched source text, the inflection chain (e.g. `past`), tags, one frequency value per installed frequency pack, the source dictionary, and its senses with part-of-speech tags.
- **Yomitan's sort chain, with one deliberate deviation (decided)**: matched source text length (longest first), **frequency order**, primary-reading match, inflection chain length (shortest first), count of exact source-term matches, dictionary order, entry score, headword text. Yomitan itself puts inflection chain length before frequency; here frequency outranks it, so a frequent deinflected verb is listed above a rare exact homophone (for `した` in `宿題をした`: 為る (past) first, then 下, then 舌). Where a key has no data (no frequency pack installed, one dictionary only), the chain falls through to the next key; with no frequency data at all the order is exactly Yomitan's. The existing JMdict `uk`/priority score is the entry score for Japanese.
- **Part-of-speech-gated deinflection** for Japanese: JMdict part-of-speech tags are stored, deinflection rules carry the word classes they apply to (for example ichidan, godan variants, `vs-i`, `vk`, `adj-i`), and a deinflected candidate is accepted only if the entry's classes match. This removes spurious candidates such as 話する.
- **Frequency packs**: installable data packs in a Yomitan-compatible shape (`term_meta_bank` style `freq` rows: a rank or occurrence value, optional reading, optional display value; the pack says which mode it is). One frequency chip per installed pack in the popup.
- **Popup behaviour like Yomitan's**:
  - Stacked entries, best first; per entry: the term over its reading, tags (inflection, "usually kana"), frequency chips, source dictionary and what matched, numbered senses with part-of-speech chips.
  - "Show more" at two levels: extra senses inside an entry, and extra entries below the first few.
  - **Popup on a popup**: while a popup is open, holding **Shift** and hovering a Japanese or Chinese word inside it opens a child popup for that word (cross-references such as "see also 為さる", CC-CEDICT glosses such as "variant of 馬|马"). Esc closes the top popup; moving away or clicking outside closes the whole stack.
- Hover and selection lookups in the reader both use the new result list. A single selected hanzi/kanji still resolves to its character entry.
- Works for Chinese with the same popup. **Chinese keeps one entry per written form with several readings** (decided; CC-CEDICT import unchanged). Ranking for Chinese uses frequency packs when present and otherwise the fallback chain.
- Webview only.

## Non-goals

- Splitting Chinese entries per reading (decided: Chinese keeps the merged multi-reading entry).
- Add-to-study from the popup, audio, mobile, user settings UI for scan modifiers or dictionary order.
- Part-of-speech data for Chinese.
- Live calls to any frequency service; all frequency data is a local snapshot.
- Changes to how CC-CEDICT glosses are parsed or stored.
- Replacing or breaking the existing core tokenizer API (`GET /api/segment/at`, `POST /api/segment`), which flashcards Round 3 will consume; the new lookup is built on top of it.

## Anti-goals

- Bundling any data with an uncertain licence. Rule: only data whose publisher states a clear CC BY-SA 4.0 (or more permissive) licence is committed or bundled, with a licence/attribution file beside it. Anything else is optional, fetched locally by a script into a gitignored directory, and must never be required for the app to work.
- The app failing, or lookup quality collapsing, when optional frequency packs are absent.
- A hover that feels slower than today: one request per hover resolution, a short debounce, no request storm from moving the pointer or from nested popups.
- Popups that flicker, trap the pointer, or cover the word being read.

## Constraints

- Repo conventions: Go backend (`server/`, pure Go, no CGO, SQLite via modernc), SvelteKit 2 / Svelte 5 SPA (`apps/web/`), plugin/pack mechanisms and importers in `server/internal/dict/` (look at how dictionary, scheme and sentence packs are manifested and installed), the reader plugin in `apps/web/src/lib/plugins/reader/`.
- **No backward compatibility (decided).** Nothing is published yet, so the existing dictionary database and its layout carry no obligation: tables, importers, the `entries`/`readings`/attrs layout and the pack formats may be redesigned from scratch, with no data migration and no re-import notes. Developer databases are simply rebuilt by seeding again. What must keep working is the code that uses the dictionary (search, entry page, flashcards, the reader, the tokenizer endpoints); it is adapted to the new schema, not its stored data.
- Licence handling as in the anti-goals. Attribution for every bundled pack must appear on the in-app Sources page and in `docs/sources.md`.
- Offsets stay Unicode code points on the wire; the client sends a short window of text around the cursor (current behaviour, at most 16 code points); the existing caps on text length and the user-auth rules of the tokenizer endpoints apply to the new endpoint unless the builder finds a reason to differ and says so.
- Japanese text uses JMdict (English glosses only today). Frequency data available under a clear licence, from the research for this design: the **Jiten** global frequency list (publisher states CC BY-SA 4.0; term + reading ranks; about 462k rows; Yomitan-format zip about 8 MB; the terms forbid reconstructing their corpus or proxying their API, so we ship a snapshot only) and Unihan's `kHanyuPinlu` (character + reading frequency, Unicode licence). Everything else researched (wordfreq zh, jieba counts, SUBTLEX-CH, BCCWJ, Leiden Weibo, JPDB/Innocent/CC100 lists) is **local-only, gitignored**.

## The parts the user decided

- Behave like Yomitan's popup: stacked entries, popup on a popup, "show more", etc.
- Nested lookup is triggered by **Shift + hover** inside a popup (reader text keeps plain hover).
- Ranking deviates from Yomitan in one place: **frequency outranks inflection chain length**, so the more frequent verb is listed first (a frequent deinflected verb above a rare exact homophone).
- Chinese keeps **multiple readings per entry**.
- Uncertain-licence data stays out of the repo (download locally, gitignore).
- Import the JMdict data we previously discarded (done for priority and `uk` on the reader branch; part-of-speech is the next piece).
- Bundle only the clearly licensed frequency data (Jiten); everything else local.

## Left to the builder

- The endpoint shape and name for the ranked list (and whether it replaces the tokenizer call in the reader or sits beside it), pagination or "all up to N" for show-more, response size caps.
- Storage: the whole dictionary schema (see the entry-model call), where part-of-speech tags live, frequency tables, indexes. Migrations may be rewritten from scratch (the existing migration chain may be collapsed or replaced; no upgrade path from the current layout is needed).
- The pack manifest for frequency packs and how they are installed (look at the existing pack types and `qinqin seed`), plus the conversion script for the Jiten data (committed as data, or as a fetch script plus a small converted file).
- The deinflection rule/condition format, how JMdict part-of-speech codes map to the conditions, and how existing rules (including the irregular する/来る/行く rows) are annotated.
- How Yomitan's sort keys map onto our data (what "primary reading match" and "exact source-term match count" mean for us), the dictionary order key, and the tie-break between frequency packs.
- Popup component structure, nested-popup state management (stack, positioning, focus), keyboard handling, performance of rendering many entries, and the exact thresholds for "show more".

## Builder's calls (mine, not agreed — please check)

- Show the first **3 entries** and the first **3 senses** per entry before the "show more" controls; the nested-popup stack is capped at **4** levels.
- Keep the existing tokenizer endpoints unchanged and add a new lookup endpoint on top of them; the reader switches to the new one.
- Dictionary order is fixed in v1 (one Japanese dictionary and one Chinese dictionary installed today); no user settings for ordering or modifier keys.
- Frequency packs are matched by term + reading when the pack has a reading, by term alone otherwise; for Chinese, Traditional forms are mapped to Simplified before matching a frequency pack that is Simplified-only.
- No frequency pack for Chinese is bundled; Chinese frequency chips appear only when the user has fetched a local pack.
- Part-of-speech tags are stored for Japanese only and shown as chips in the popup.
- **Entry model (answers the builder check; updated after the no-compatibility decision):** because the old database can be thrown away, do NOT layer a second store on top of the merged entries. Redesign the dictionary storage so the unit of a Japanese result is **one JMdict word (`ent_seq`)**: its forms, its readings, its senses with a part-of-speech set per sense, the word-level `uk`/priority score, and frequency per (term, reading). The importer stops merging JMdict homographs. Chinese keeps its decided shape: one entry per written form carrying all its readings and glosses. The builder designs the whole schema (entry identity, readings, senses, tags, frequency tables, indexes) and adapts search, the entry page, flashcards and the tokenizer to it; `entries` ids need not stay stable across the rebuild. Existing tests that encoded the old merged layout are rewritten, not preserved.
- **Part-of-speech gating:** a deinflected candidate is accepted for a word row if ANY of its senses' part-of-speech tags satisfies the rule's condition (Yomitan does this at term level). Candidates failing the gate are dropped before ranking.
- **New chain fully replaces the reader's reading-hit ordering for the new lookup.** The older rules ("written-form beats reading hit", "exact beats deinflected", `uk`+priority ordering) remain only inside the existing tokenizer endpoints, which flashcards Round 3 may use and which stay unchanged. "Primary reading match" means: the matched text equals the word's first listed reading or first listed written form (the headword), not merely one of its alternative forms.
- **Endpoint and limits:** the new lookup endpoint is public, like `GET /api/segment/at`, takes the same short window (at most 16 code points on the client, 64 on the server) and returns at most 30 entries; "show more" is client-side over the returned list, not another request. Nested lookups only fire on Shift+hover (debounced), so they cannot flood the server.
- **Jiten snapshot:** commit a compact converted file (not the Yomitan zip) with its CC BY-SA 4.0 licence and attribution files beside it; add an in-app Sources entry. Frequency for Chinese, when a local pack is present, is matched through CC-CEDICT's own simplified/traditional pairs (and Unihan variants for single characters); no client-only conversion is used on the server.
- **Chinese uses the same "show more" thresholds** (3 entries, 3 senses, nested depth 4); for Chinese the entry list is usually one merged entry with several readings, shown as one stacked entry listing all readings.
- **Fallback when frequency is absent:** the chain falls through; Japanese then ranks by inflection chain length and the `uk`/priority score; Chinese by matched length and headword text.

## Implementation notes

What was built, where it differs from the design above.

**Schema.** Migrations 014-016 built the lexicon beside the legacy tables;
migration 017 dropped the legacy tables and renamed the lexicon ones, with no
data moved (a database is rebuilt by seeding again). Final tables: `entries`
(language, kind `word`|`character`, `ext_key`, `pri`, `uk`, `attrs`), `forms`
(text, flags), `readings` (type, value, `plain`, flags), `senses` (per
dictionary: `pos`, `tags`, `glosses`, `xrefs` as JSON text), `entry_links`
(`variant`, stored both ways, and `radical`), `frequency_packs` (`ord` = priority,
`content_hash`) and `frequency` (term, reading, rank, display). Every lexicon
table soft-deletes and stamps `updated_at`, which the delta sync pulls by.
Japanese: one entry per JMdict `ent_seq`, POS per sense. Chinese: one entry per
simplified form, traditional forms as `trad`-flagged forms, all readings, one
sense per CC-CEDICT line.

**Sort chain as built** (`server/internal/lookup/rank.go`): matched source
length, frequency rank (entries without data last; a no-op when no pack has
data), primary-reading match, inflection chain length, exact-match count,
dictionary order, entry score (usually-kana with priority, then priority), then
headword and entry id. This deviates from Yomitan: matched length and frequency
lead, and frequency outranks the inflection chain. History: primary-reading
match first sat above frequency, as in the design, but merged JMdict entries
lose Yomitan's per-reading headwords (行く lists いく before ゆく while 征く
lists ゆく first), so a rare word reading the matched kana first beat the
frequent one; it moved below frequency. The ranking pack is the first pack, in
priority order, with data for any of the entries.

**Endpoints and limits.** `GET /api/lookup` is public: `text` at most 64 code
points (413 above), at most 30 results, `kind` (`word`|`character`) repeatable,
an engine window of 12 code points. `GET /api/segment/at` is public (64 code
points); `POST /api/segment` needs a user (5000 code points, 256 KiB).
`GET /api/sync/pull?collections=` limits a pull to the named Delta collections;
its cursor is valid only for the collections requested. `GET /api/frequency-packs`
lists packs with licence and attribution. The web popup stack is in
`apps/web/src/lib/plugins/reader/`: 3 entries and 3 senses before "show more",
Shift+hover nested popups to depth 4, Esc closes the top popup, an outside click
closes the stack.

**Tokenizer.** The tokenizer endpoints are now a thin layer over the lookup
engine (this replaces the design's "unchanged"): the match is the longest text
any result matched; `Lemma` is the dictionary form and `Reason` the
deinflection of the best-ranked result; only `Entries[0]` corresponds to
`Lemma`/`Reason`, later candidates (at most 8) are other readings or entries with
the same surface. `lexicon.Store.BestWord` resolves level and sentence pack
words: by written form, else by kana reading (word entries whose first reading
is that kana and which are written in kana or marked `uk`). Known
imperfections of that fallback: いう, わるい, あつい, さむい and たかい stay
unresolved; だれ resolves to ダレ, いる to 要る, なる to 生る and やすい to 易い.

**Licence decisions.** The Jiten global frequency list is bundled on the
publisher's stated CC BY-SA 4.0 (the frequency-dictionaries page and terms
article 6.1, with 6.2) read against article 5(c) of the same terms; with ranks
unmodified, attribution and the licence text beside the file. Data with an
uncertain licence is local-only (`plugins/data-local/`, gitignored). See
`docs/sources.md`.

**Known limitations.**

- JMdict `re_restr`, `re_nokanji`, `stagk`, `stagr`, `field`, `dial` and
  `s_inf` are not imported.
- CC-CEDICT's pairing of a gloss with its reading is lost in the merged entry
  (senses are kept per line but a reading is not tied to them in the view).
- The gloss tier of search scans all senses (about 100 ms).
- Chinese search hits are ordered by id within a tier: there is no Chinese
  frequency yet, and the Chinese frequency packs are local-only.
- Popups are not re-placed when the window is resized.
- Opening a popup from a selection does not move focus into it.
