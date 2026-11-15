# Pronunciation audio packs (issue #43) — design

Status: proposed, 2026-11-15. Autonomous design (nobody was available to answer
questions); every decision is a "Ruling" so the owner can undo it.

## Goal

A play button that pronounces a word or character in the entry view and during
study, for Mandarin (pinyin/zhuyin entries) and Japanese (kana readings), from
installed audio packs, with per-clip credits, immutable caching for the web and
a cache design the Android client (#35, #38) can follow. The licence rule
applies unchanged: unclear or restrictive audio is fetched locally, gitignored
and never bundled; the app works without any audio.

The repository has no `LICENSE` file; compatibility is judged against the
bundling bar (CC BY-SA 4.0 or more permissive, licence text and attribution
beside the data).

## Licence evidence (checked 2026-11-15)

Sites unreachable today (503/403/404: lingualibre.org, forvo.com/license,
shtooka.net, JapanesePod101 terms) are marked unverified.

| Source | Evidence | Verdict |
|---|---|---|
| **Kanji alive** example-word audio (ja; 10,187 clips, male/female native speakers, 6–12 words per kanji for 1,235 kanji) | https://github.com/kanjialive/kanji-data-media `LICENSE.md` at e1e24d3: "This work by Kanji alive is licensed under a Creative Commons Attribution 4.0 International License"; the README names only two fonts as exceptions. Audio: https://media.kanjialive.com/examples_audio/audio-opus.zip (68,687,036 bytes, Last-Modified 2026-09-04). Word ↔ file mapping in `language-data/ka_data.csv` (`kname`, `examples`). | **BUNDLE-eligible** (licence); not committed to git (size), see Rulings |
| **Wikimedia Commons** pronunciation files (zh, ja) | Licence per file, machine-readable through the API (`prop=imageinfo&iiprop=extmetadata`: `LicenseShortName`, `LicenseUrl`, `Artist`). Samples: `File:Zh-nǐ.ogg` "CC BY 2.0 fr" (Wei Gao, Vion Nicolas); `File:Zh-shi4.ogg` "CC BY-SA 2.0 uk", noted "not a native Mandarin speaker"; `File:Zh-ma1.ogg` missing. | **LOCAL-ONLY** tool with a per-file licence allow-list (see Rulings) |
| **Lingua Libre** (cmn 4,108, jpn 5,616 files on Commons) | Files carry CC BY-SA 4.0, CC BY 4.0 or CC0 per Commons metadata; the default "CC BY-SA 4.0" comes from a snippet of the RecordWizard manual (site 503, unverified). | **LOCAL-ONLY** through the same Commons tool |
| **hugolpz/audio-cmn** (1,707 syllables, ~8k HSK words) | README: "CC-by-sa. See table upper for authors."; no version; refers to an unreachable Shtooka readme; GitHub shows no licence. | **LOCAL-ONLY** (version unverified) |
| **cjhoward/cedict-tts** | Audio "CC0 1.0 Universal", but "Baidu Speech-generated TTS MP3s"; Baidu's output terms unchecked. | **LOCAL-ONLY** |
| **Tatoeba** audio | https://tatoeba.org/en/downloads: "If the license field is empty, you may not reuse the audio outside the Tatoeba project"; others vary (incl. NC/ND). Sentences, not words. | Out of scope (sentences); LOCAL-ONLY if ever |
| **Forvo** | Proprietary licence since 2019 (https://en.wikipedia.org/wiki/Forvo); API non-profit plan "No commercial use" (https://api.forvo.com/). | **REJECT** |
| **JapanesePod101** (Yomitan's default) | No public licence found. | **REJECT** |
| davinfifield/mp3-chinese-pinyin-sound | Unlicense, but no speaker or source named. | **REJECT** (provenance) |
| Tone Perfect (MSU) | "© Michigan State University", access on request. | **REJECT** |
| **eSpeak NG** (engine GPL-3.0+) | Output not addressed by the project; poor Mandarin/Japanese quality. | **REJECT** for packs (quality) |
| **Piper** voices: zh_CN-huayan (dataset licence "unknown" in MODEL_CARD), ja_JP-hi_fi_captain ("by-nc-sa/4.0") | huggingface.co/rhasspy/piper-voices MODEL_CARDs. | **REJECT** |
| **Coqui XTTS-v2** | "Coqui Public Model License" (non-commercial). | **REJECT** |
| **Kokoro-82M** | "Apache-licensed model"; trained partly on synthetic audio from closed TTS providers; Mandarin voices graded D, Japanese C. | **REJECT** for v1 (quality, provenance caveat) |
| Browser / OS speech (Web Speech API, Android TextToSpeech) | Nothing is distributed: the user's own device voices speak at runtime. | **USE** as fallback |

## Rulings

- Ruling: nothing audio is committed to git — the only clean bundle candidate
  (Kanji alive opus, 69 MB) would bloat every clone, and Commons/Lingua Libre
  are moving per-file sets — cost if wrong: users run one fetch script.
- Ruling: Kanji alive is the one **redistributable** pack: fetched by
  `scripts/fetch-audio-kanjialive.sh` (pinned commit e1e24d3, SHA-256 of the
  zip pinned; refuses on mismatch) into the gitignored `plugins/data-audio/`,
  and baked into the Docker image by default (`ARG WITH_AUDIO=1`, like
  `WITH_OCR`) — best out-of-the-box Japanese audio with a clear CC BY 4.0
  licence — cost: image +~70 MB and the build depends on
  media.kanjialive.com (`--build-arg WITH_AUDIO=0` skips it).
- Ruling: `plugins/data-audio/` (clean, redistributable, gitignored for size)
  is separate from `plugins/data-local/` (unclear licence, never distributed);
  the Dockerfile copies only `data-audio` — cost: one more directory.
- Ruling: Commons/Lingua Libre go through a local tool
  (`scripts/fetch-audio-commons.mjs`) that keeps a file only when its
  `LicenseShortName` is in {CC0, CC BY 2.0–4.0, CC BY-SA 2.0–4.0 incl.
  national ports, Public domain} and records `Artist`, licence and file page
  URL per clip; it writes to `plugins/data-local/` — per-file metadata is
  machine-readable but quality and coverage are uneven and the set keeps
  changing — cost: no Mandarin audio out of the box.
- Ruling: Mandarin out of the box uses the device voice (Web Speech API,
  `lang` `zh-CN`; Japanese `ja-JP`) when no clip exists, labelled "Device
  voice" — licence-clean and covers every entry — cost: quality depends on the
  OS; some browsers have no Chinese voice (then no button).
- Ruling: no TTS-generated packs in v1 — every engine checked is either
  restricted or weak in zh/ja — cost: revisit when a permissive zh voice
  appears.
- Ruling: Mandarin words without a word clip play their syllable clips in
  sequence (from the entry's pinyin, tone numbers) only when every syllable has
  one; Japanese never concatenates — pitch accent makes mora concatenation
  misleading — cost: Japanese words without a clip fall back to device voice.
- Ruling: clips are served to signed-in users only — a self-hosted instance
  must not become a public mirror of local-only audio — cost: the public
  Sources page cannot preview audio (it still lists credits).
- Ruling: autoplay is off by default, per workspace setting — sound without a
  gesture surprises and browsers block it — cost: one setting to find.

## Pack format

```
plugins/data-audio/kanjialive-audio/
  manifest.json     type "audio", format "audio-index", language "ja",
                    license "CC BY 4.0", attribution, notice
  index.tsv         kind  form  reading  file  license  attribution  source
  audio/…           .opus | .ogg | .mp3, each ≤ 2 MiB
  LICENSE, ATTRIBUTION.md
```

- `kind` `term`: `form` + `reading` (kana, or pinyin marked or numbered).
  `kind` `syllable` (zh only): `form` empty, `reading` numbered toneful pinyin
  `ni3`, `lv4` for lǜ, tone 5 for neutral.
- Per-row `license`/`attribution`/`source` override the manifest's; empty
  means the manifest's. A row whose `license` is empty and the manifest's
  `license` is "per file" is rejected.
- `dict.Manifest` gains `TypeAudio = "audio"` and `FormatAudioIndex =
  "audio-index"`; `ValidateNotice` and required `license`/`attribution` apply.

## Server

- Migration `026_audio.sql`: `audio_packs(id, pack_id UNIQUE, language, name,
  version, license, attribution, notice, created_at)` and `audio_clips(id,
  pack_id, kind, form, reading_key, sha256, ext, bytes, license, attribution,
  source)` with index `(kind, form, reading_key)` and `(sha256)`.
- Package `internal/audio`:
  - `Import(ctx, db, pack dict.Pack, store string) (Result, error)`: validates
    rows, copies each file into `<data>/audio/<sha[:2]>/<sha>.<ext>`
    (content-addressed, written via temp + rename), replaces the pack's rows in
    one transaction, then removes blobs no row references. Extension and
    sniffed magic must agree (`OggS`, `ID3`/MPEG frame sync).
  - `ReadingKey(lang, reading string) string`: ja → hiragana, no spaces; zh →
    numbered pinyin, lowercase, no spaces (`pinyin.ToNumbered`, new in
    `internal/pinyin`).
  - `Resolve(ctx, db, entry) (Resolution, error)`: term clips matching the
    entry's written form and first reading (all packs, pack order); else, zh
    only, the syllable sequence when complete.
- `seed`: `importOrder[TypeAudio] = 4`; the default roots gain
  `plugins/data-audio` when it exists (after `data`, before `data-local`).
- Routes (all signed-in except the credits list):
  - `GET /api/audio/entries/{id}` → `{"terms":[Clip], "syllables":[Clip]|null}`.
  - `POST /api/audio/resolve` `{"entryIds":[…]}` (≤ 200; body ≤ 16 KiB) →
    `{"<id>": Resolution}` for study prefetch and Android.
  - `GET /api/audio/clips/{sha}.{ext}` → `http.ServeContent` (Range, 304),
    `Cache-Control: private, max-age=31536000, immutable`, `Content-Type`
    `audio/ogg` or `audio/mpeg`, `X-Content-Type-Options: nosniff`; 404 unless
    a row references the hash.
  - `GET /api/audio-packs` (public) → packs with `license`, `attribution`,
    `notice`, `clipCount`, for the Sources page.
  - `Clip` = `{url, packId, license, attribution, source}`.

## Web

- `lib/api/audio.ts`: `getEntryAudio(id)`, `resolveAudio(ids)`, cached per
  entry id for the session.
- `lib/audio/player.ts`: one shared `HTMLAudioElement`; `play(clips)` plays a
  sequence, a new call stops the old one; `stop()` on navigation;
  `speak(text, lang)` for device voice (`speechSynthesis`, picks a voice whose
  `lang` starts with `zh`/`ja`; `null` when none).
- `lib/components/PlayButton.svelte`: `aria-label="Play pronunciation"`,
  states idle/playing/unavailable; title shows "Audio: <attribution> ·
  <license>" or "Device voice".
- Entry page: button beside the headword; for a zh character, one per pinyin
  reading in `Readings.svelte` (syllable clip or device voice). A credit line
  under the readings while a clip is used.
- Study: `VocabCard` and `ToneCard` show the button after reveal only (never
  before: it would give the answer away); key `p` plays; autoplay on reveal
  when the workspace setting `audioAutoplay` is on. The session prefetches
  `resolveAudio` for its queue and preloads the next card's clip.
- Settings → workspace: "Play audio on reveal" (`audioAutoplay`, default off),
  "Use device voice when no recording exists" (`audioDeviceVoice`, default on).
- Sources page: an "Audio" section from `/api/audio-packs`; a pack with
  per-file credits links to `GET /api/audio-packs/{id}/credits?offset=&limit=`
  (public, text only: `form`, `reading`, `license`, `attribution`, `source`
  per clip, limit ≤ 500).

## Offline and Android

- Web: clip URLs are content-addressed and immutable, so the browser HTTP
  cache keeps them; no service worker exists and none is added in v1.
- Android (design for #35/#38, not built here): Room table
  `audio_cache(sha256 PK, ext, bytes, last_played_at, pinned)`; files under
  `cacheDir/audio/`; LRU eviction above a user cap (default 200 MB); on Wi-Fi
  before a session, `POST /api/audio/resolve` for the queue's entries and
  download missing hashes; a pinned flag keeps clips of the current deck. An
  optional "download pack for offline" fetches every clip of a pack via
  `GET /api/audio-packs/{id}/clips` (paged list of hashes) — listed here as
  the contract, built with the Android work. Device voice uses Android
  `TextToSpeech`.

## Degradation

No packs installed and no device voice → no play buttons, nothing else
changes. A clip that 404s (pack removed) hides its button and falls back to
device voice. Resolve errors never block a study card.

## Testing

Go: import (validation, copy, dedup, GC, magic mismatch, per-file licence),
`ReadingKey`, `ToNumbered`, resolve order and syllable completeness, routes
(auth, 404 for an unreferenced hash, Range, headers, body limit). Scripts:
index generation from a fixture `ka_data.csv`; the Commons tool's licence
filter on recorded API JSON fixtures (no network in tests). Web: player
sequencing and stop, device-voice choice, PlayButton states, cards show the
button only after reveal, settings defaults. Real-app check with a generated
two-clip pack (synthesised tones, CC0, made by the test) and, locally, the
fetched Kanji alive pack.

## History scan (review gate)

All must print nothing: `git ls-files plugins/data-audio plugins/data-local`;
`git log --all --name-only --format= | grep -Ei '\.(opus|ogg|mp3|wav|m4a|aac)$'`
(test clips are generated at test time, never committed); `git log --all --name-only --format= | grep -i
'ka_data\|audio-opus'`.

## Risks

- Kanji alive file ↔ example mapping (suffix a–l = n-th example) is from its
  README; a spot-check of 10 clips is a manual step of the plan.
- media.kanjialive.com availability affects default image builds.
- CC BY 4.0 attribution must reach users of the Docker image: manifest
  attribution on the Sources page plus the per-clip line in the entry view.
