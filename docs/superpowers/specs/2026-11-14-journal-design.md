# Journal Plugin with In-App AI and OCR — Design

Date: 2026-11-14
Status: approved by the owner (2026-11-14) with per-workspace explanation language and temporary photos.
Supersedes the Journal part of `2026-11-12-mcp-journal-design.md` (MCP moved to
Future, #45). Issue: #46.

## Intent and why

The learner writes in the language they study and wants real feedback on it:
which sentences are wrong, how to fix them and why, plus an overall review.
When they have no idea what to write, the AI suggests topics based on the words
they have been studying and what they wrote before. People who prefer paper can
photograph a handwritten page and get it into the journal as text.

The owner decided (2026-11-14) that **the app calls the AI itself with the
user's own provider API key**. MCP is not the path for now. Without a key the
journal still works, and photos are read by an offline OCR engine.

## Goals

- Journal entries per workspace: date, title, text in the workspace language.
- **AI review** on request: sentences/spans underlined with a correction and an
  explanation, plus an overall review (summary, what went well, what to work on).
- **Topic suggestions** on request from studied words and past entries.
- **Photo import:** upload a photo of a handwritten or printed page, get a
  transcription draft, correct it next to the photo, save it as an entry.
  With a key the AI reads the photo; without a key Tesseract does.
- **Correction guidance** the learner writes once (style, strictness, focus),
  used in every review.
- Every AI answer respects the workspace language (no Chinese feedback in a
  Japanese journal).

## Non-goals

- MCP (moved to Future, #45), a chat UI, free-form conversation with the AI.
- More than one provider at launch: a provider interface exists, Claude is the
  only implementation.
- Review history: one review per entry, replaced when the learner asks again.
- Android UI (v0.4.0); the data model and endpoints are shared with it.

## Anti-goals

- The API key reaching the browser, logs, sync payloads or backups in plain text.
- Text or photos sent to the provider without an explicit action by the learner.
- Underlines that point at the wrong words after the learner edits the entry.
- Feedback in the wrong language, or AI text presented as certain when the
  model only guessed (e.g. a transcription is always a draft to check).

## Constraints

- Approach A: the journal is a feature plugin (`qinqin-journal`) storing its
  documents as workspace-scoped plugin data, like flashcards; AI and OCR are
  small core services on the Go server (precedent: the reader plugin's
  `library` server package and book files under the data dir).
- Licence-first rule: Tesseract (Apache 2.0) and its `chi_sim`, `chi_tra`,
  `jpn` models (Apache 2.0) are bundled in the Docker image and credited on the
  Sources page through the plugin's `sources`. The Anthropic Go SDK (MIT) is a
  new server dependency.
- Server secret: encrypting keys needs a new env var `QINQIN_SECRET` (32 random
  bytes, base64). Without it the AI key settings are disabled with a clear
  message; keys are never stored unencrypted. Documented in the README and the
  compose example.
- Body caps like the other routes; photos capped (10 MB, JPEG/PNG/WebP).
- Migrations continue after `024_pack_notice.sql`.

## Approaches

- **A. Plugin for the journal data, core AI and OCR services on the server
  (CHOSEN by the owner).** Key stays on the server; Android reuses the same
  endpoints; the journal syncs like other plugin data. Costs a server secret.
- **B. Everything in core tables and endpoints.** Easier server queries and
  history, but against the plugin model and needs its own sync path. Rejected.
- **C. Everything in the browser (direct AI calls, tesseract.js).** No server
  work, but the key lives in the browser, OCR models are a large first
  download, and Android would redo it all. Rejected.

## Design

### Data (plugin data, plugin `qinqin-journal`, workspace-scoped)

- `entry:<ulid>` — `{id, date, title, text, source: "typed"|"photo", createdAt, updatedAt}` (entries keep no photos)
- `review:<entryId>` — `{entryId, textHash, annotations: Annotation[], overall: {summary, strengths: string[], focus: string[]}, model, createdAt}`
  - `Annotation` — `{id, quote, prefix, suffix, correction, explanation, category: "grammar"|"word choice"|"spelling"|"style"|"other"}`
    (quote + a few characters of context on each side, the W3C text-quote idea).
- `suggestions` — `{items: [{title, prompt, words: string[]}], model, createdAt}` (latest set only).
- `settings` — `{guidance: string, explanationLanguage: string}` **per workspace** (owner's decision): e.g. Japanese explanations in the Japanese workspace, English in the Chinese one. Default English.

### Photos (server package `journal`)

- `POST /api/journal/photos` (multipart, owner + workspace checked) stores
  `<data>/journal/<userId>/<photoId>.<ext>` and returns `{photoId}`.
  `GET /api/journal/photos/{id}` serves it to its owner only.
  **Photos are temporary (owner's decision): deleted as soon as the learner is
  done with them.** The photo lives only while its transcription draft is open:
  `DELETE /api/journal/photos/{id}` runs when the learner saves the entry or
  discards the draft. Leftovers (closed tab, crash) are removed by a sweep at
  startup and every 15 minutes for photos older than 1 h. Deleting a workspace
  removes its pending photos (extend the cascade in `handlers_workspaces.go`).
  Photos are never synced and never sent to the provider again after transcription.
- `POST /api/journal/transcribe {workspaceId, photoId, engine: "ai"|"offline"}` → `{text, engine}`.
  The learner chooses explicitly: after picking a photo the UI shows **Read with
  AI** (only with a key, preselected) and **Read offline**. Picking a photo never
  sends it anywhere by itself. If the AI call fails, the error is shown with a
  **Read offline instead** button; there is no silent fallback.
  `ai`: the AI reads the image (vision input) and returns the text only.
  `offline`: `tesseract` runs as a subprocess with a timeout, models picked from
  the workspace language (`chi_sim+chi_tra` for zh, `jpn` for ja, `eng` for
  Latin-script languages). The result is a draft; nothing is saved until the
  learner saves the entry.

### AI service (server package `ai`)

- Table `ai_keys(user_id, provider, ciphertext, nonce, hint, model, created_at, last_used_at)`;
  AES-GCM with `QINQIN_SECRET`. `hint` = last 4 characters for display.
- Endpoints: `PUT /api/ai/key {provider, key, model?}` (validated with one
  cheap test call before saving), `GET /api/ai/key` → `{provider, hint, model}`
  or 404, `DELETE /api/ai/key`.
- Provider interface: `Review`, `Suggest`, `Transcribe`. Claude implementation
  with the official Go SDK: default model `claude-opus-5-5` (selectable in
  Settings: Opus 5.5, Sonnet 5.5, Haiku 5.5 — cost is the learner's choice),
  adaptive thinking, structured outputs (`output_config.format`, a JSON schema
  per task) so replies parse reliably, `stop_reason` checked. Refusals: on Opus
  5.5 and Sonnet 5.5 requests enable the API's server-side refusal fallback
  (`fallbacks: "default"`, which may answer from another model on the learner's
  key); Haiku 5.5 has none, so a refusal there is shown as a clear message. No
  OCR or other local fallback for reviews. Typed errors mapped to messages
  ("key rejected", "provider busy, try again", "quota exhausted").
- Journal endpoints: `POST /api/journal/review {workspaceId, entryId}` and
  `POST /api/journal/suggestions {workspaceId}`. The server reads the needed
  plugin data itself, calls the provider, validates the reply and writes the
  `review:`/`suggestions` document, then returns it.
- Prompts state the workspace language, the explanation language and the
  learner's guidance, and tell the model to keep the learner's script (no
  simplified/traditional or kana/kanji conversions unless that is the error).
  Validation works per annotation and never rejects the whole reply: it drops
  annotations whose `quote` is not found in the entry text, and annotations
  whose `correction` has no character of the workspace language's writing system
  (Han for zh; Han or kana for ja; Latin letters for Latin-script languages —
  digits, punctuation and Latin inside zh/ja corrections are allowed). Dropped
  counts are logged.
- Suggestions input: words from the last 30 days of flashcard reviews (cards in
  `qinqin-flashcards` plugin data + review events), plus titles and the first
  lines of the last 10 entries. Only this summary is sent, not every entry.
- Limits: entry text up to 5,000 characters per review; 30 AI calls per user per
  hour; one in-flight call per user.

### Anchoring after edits

On render, each annotation is located by `quote` + context (exact match first,
then quote alone if unique). Not found → listed under "No longer in the text".
If the entry's text hash differs from `review.textHash`, the review shows
"Written for an earlier version" with a **Review again** button.

### Web UI (plugin page `/p/journal`)

- List of entries by date (newest first), New entry, Upload photo.
- Editor: date, title, text. Buttons: **Review**, **Ideas** (both disabled with
  a hint and a link to Settings when no key is set).
- Review view: wavy underlines on annotated spans; tap/click or focus opens the
  correction and explanation; keyboard reachable list of all annotations; the
  overall review panel above the text.
- Ideas panel: suggested topics with the words they use; "Start an entry"
  pre-fills the title.
- Photo flow: pick or take a photo → transcribing… → photo and editable draft
  side by side → Save as entry.
- Settings: an **AI** section (add/remove key, model, a plain note on what is
  sent to the provider and when). The journal's own settings, per workspace:
  correction guidance and explanation language.
- Photo flow, after Save or Discard: the photo is deleted and the editor shows
  only the text.
- Activity: creating an entry, and each save that changes its text, emits a
  `journal` study event `{entryId}` at save time (the day the learner did the
  work, not the entry's `date`). The core heatmap gets a "Journal" source that
  counts 1 point per distinct `entryId` per UTC day.

## Testing

- Go: key encryption round trip, missing `QINQIN_SECRET` behaviour, owner and
  workspace checks on every route, photo size/type limits, Tesseract runner
  with a fixture image (skipped when the binary is absent, run in CI's image),
  provider replies parsed and validated with a fake provider (quotes not found,
  wrong script, refusal, 401/429 errors), rate limit, workspace deletion
  removes photos.
- Web: anchoring and re-anchoring (pure module), review-outdated detection,
  suggestion and review rendering logic; gates as usual; one real-app run with
  a fake provider; one manual run by the owner with a real key.

## My calls (made without asking; reject any)

- Default model Opus 5.5, selectable down to Sonnet 5.5 / Haiku 5.5.
- Explanations default to English; set per workspace with the guidance.
- Leftover photos (closed tab) are swept after 1 h.
- Explicit "Read with AI" / "Read offline" choice; no silent fallback.
- Validation drops single annotations, never a whole paid reply.
- Server-side refusal fallback on Opus/Sonnet; none on Haiku.
- Heatmap counts journal work on the day it was saved.
- One review per entry (no history); latest suggestion set only.
- Limits: 5,000 characters per review, 30 AI calls/hour, 10 MB photos.
- With a key, transcription uses the AI rather than Tesseract.
- Journal entries count towards the activity heatmap.
- Suggestions use the last 30 days of reviews and the last 10 entries.

## Left to the builder

- Exact prompts and JSON schemas; the Tesseract page-segmentation mode.
- Exact Alpine package names for Tesseract and its models (verify on 3.22).
- Rendering technique for underlines; photo display layout on narrow screens.
- Migration number and table layout details.
