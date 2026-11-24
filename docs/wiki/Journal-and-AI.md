# Journal and AI providers

The **Journal** (`/journal`, the journal icon in the top bar or the phone menu) is a core feature where you write dated entries per workspace, in the language you are learning. It is on until you switch it off in [Settings → Features](Settings-tour#features).

The AI features (a review with corrections in the margin, topic ideas, a [conversation partner](#conversation-partner), and turning a photo of a page into an entry) are optional. They use **your own API key** for a provider you choose; qinqin ships no key and sends nothing to any provider on its own. Reading a photo **offline** needs no AI at all.

> **Status.** The AI provider integrations are covered by tests against fake providers. They have **not yet been tested with real keys** by the project owner. Some provider details are marked unverified in the code (see "Provider notes" below). Expect rough edges until a real key has been tried.

## The journal page

On a wide screen the journal is three columns: your entries on the left (date, title, a small dot when an entry has been reviewed), the page in the middle (date, title, text), and the margin on the right (topic ideas while you write; corrections after a review, like comments in a document). From 720 px the page and margin stay side by side and the entries move behind an **All entries** link; on a phone the list is its own view and the entry shows one column.

- **New entry** starts one; the text saves by itself as you type ("Saving…", "Saved"; "Not saved. Retrying when you keep typing, or press Save."). An entry holds up to 50,000 characters; a review reads at most 5,000 ("Longer than 5,000 characters: you can save it, but shorten it to get a review"). **Delete** removes an entry and its review (asked first).
- **Upload photo** starts a photo draft ([Photo to entry](#photo-to-entry)); **Resume photo draft** comes back to an open one.
- **Journal settings** (per workspace): **Correction guidance** (up to 2,000 characters, for example "I am a beginner, keep explanations short"; it cannot change the languages or the format of the review) and the **Explanation language** the AI explains in (English, German, French, Spanish, Italian, Portuguese, Dutch, Russian, Japanese, Chinese (Simplified), Chinese (Traditional) or Korean).

Journal entries count for the [heatmap](Stats-and-heatmap), [daily goals](Daily-goals), the [weekly summary](Weekly-summary) and [milestones](Milestones). They sync and are part of [your data](Your-data). The journal needs a connection.

## Review

**Review** sends the entry to your active provider and comes back with corrections and an overall review ("Reviewing… (this can take a minute)"). The button explains when it cannot run: "Write something first", "Add an API key in Settings → AI", or "Shorten the entry to 5,000 characters to review it".

A correction is a **mistake** (something wrong) or a **suggestion** (correct, but it could be more natural), in a category: Grammar, Spelling, Word choice, Style or Other. Mistakes get a wavy underline in the theme's mistake colour, suggestions a dotted one in the suggestion colour; the open correction is tinted and expands in the margin with the category, what you wrote struck through, the fix in green and why. The margin counts them ("3 mistakes", "2 suggestions"); a correction the AI gave for words it could not find in your text is listed under "Not placed in the text". Reviews made before the mistake/suggestion distinction existed show every correction as a mistake. On a phone, tapping a correction opens it in the same bottom sheet as the reader's lookup; swipe or use the arrow keys for the next one.

The **Overall** review sits below the text, with **What went well** and **Focus next**, and names the provider and model that answered. On Anthropic's Opus and Sonnet a safety refusal can be retried by the provider's fallback model on your key; the review then says "Answered by … (fallback)". Other providers have no fallback.

The review is stored with the entry. Editing the text afterwards marks it as **Written for an earlier version**: corrections for words you changed move to "No longer in the text", and **Review again** asks for a new one.

## Topic ideas

**Get ideas** (in the margin, and **Ideas for today** in the list) asks for writing prompts based on your recently studied words and the openings of your last entries, with **Words to try**. **Start an entry** begins an entry from an idea.

## Conversation partner

**Talk with the AI** (in the entries column, `/journal/talk`) is a chat in the workspace's language with the AI at your level, on your own key like the rest of the journal.

- **Start a conversation** with an optional **Topic** (type one, or take one of the **Topic ideas**; empty lets the partner pick an everyday topic) and **Your level**: Beginner, Elementary, Intermediate or Advanced. A new conversation starts at the level of your latest one. **Let the partner begin**, then write your answers under **Your message** and **Send** (Ctrl+Enter or ⌘+Enter on a keyboard).
- Your messages get the journal's corrections: mistakes and suggestions are underlined in your message and listed in the margin, or on a phone behind **Show corrections** in the same bottom sheet as a review. The explanations use the explanation language of the Journal settings, and the correction guidance applies.
- The partner's replies are lookup text like a book in the [reader](Reader): hover or tap a word to see its entry, and **+** adds it to a deck of this workspace.
- The line under the title names the provider and model of the latest reply ("Answered by …").
- **Save as journal entry** turns the conversation into an entry titled with the topic (the partner's lines start with "> ") and opens it; you can review it like any entry. **Discard** deletes the conversation (asked first). Open conversations are listed on the Talk page until you save or discard them.

The partner always answers in the workspace's language and script; a reply in another language is refused ("The reply could not be read") and nothing is stored, so you can send again. A failed reply keeps your text in the box. A conversation holds up to 50 messages, a message up to 1,000 characters (replies are cut at 800), and a workspace up to 20 open conversations.

## Photo to entry

Choose a photo of a handwritten or printed page (JPEG, PNG or WebP, up to 10 MiB and 25 megapixels). On the server it is stripped of metadata including GPS, rotated upright and shrunk, and kept only while the draft is open. Then:

- **Read with AI** sends it to your provider ("Sends this photo to your AI provider with your own key"). A model that cannot read photos makes this unavailable ("<model> can't read photos") and the page offers **Read offline instead**.
- **Read offline** runs Tesseract on the server and sends the photo nowhere else ("Runs on the server; the photo goes nowhere else"). It reads Chinese (simplified and traditional), Japanese and Latin-script languages; vertical Japanese is read poorly. Other languages have no offline model, and a server without Tesseract shows it as "not installed on this server".

There is no automatic fallback between the two. The transcription is a draft: check it against the photo (**Show photo**), edit it and **Save as entry**, or **Discard**. The photo is deleted when you save or discard the draft; a draft forgotten for about an hour expires (your text is kept and can still be saved).

## Setting up a provider

1. An administrator must have set `QINQIN_SECRET` (see [Server secret](#server-secret)). Without it Settings → AI says "AI features are off on this server", and the rest of the app works.
2. Open **Settings → AI** and **Add a provider**: pick one, enter your API key (**Get a key from <provider>** links to its page), optionally a model, and save. The key is checked with the provider (one call counts toward your hourly limit), stored encrypted, and the first stored key becomes **Active**. Only the last four characters are shown afterwards ("key …abcd").
3. You can store one key per provider, **Make active** another, **Change model**, **Test key** and **Remove** a key. You may type any model id; the list only suggests. The defaults are the providers' flagship models, which are also the most expensive: choose a cheaper model if cost matters.

Settings → AI shows, where you type a key, "Your journal text, conversation messages, guidance and the photos you choose to read with AI are sent to <provider> when you press a button. <provider>'s terms apply.", and below the list the calls and tokens used this hour. It links to the Journal settings. A key the server can no longer read (after the server secret changed) says "Enter the key again"; a provider the server turned off says "Turned off by the server" and offers only Remove.

| Provider | Default model (also suggested) | Reads photos |
|---|---|---|
| Anthropic | `claude-opus-5-5` (`claude-sonnet-5-5`, `claude-haiku-5-5`) | yes |
| OpenAI | `gpt-6-astra` (`gpt-6-luna`) | yes |
| Google Gemini | `gemini-3.8-flash` (`gemini-3.5-flash-lite`) | yes |
| DeepSeek | `deepseek-flash` (`deepseek-v4-pro`) | `deepseek-flash` only |
| Mistral | `mistral-large-latest` (`mistral-small-latest`) | yes |
| xAI | `grok-4.7` | yes |
| Groq | `openai/gpt-oss-120b` | no |
| OpenRouter | `openrouter/auto` | depends on the routed model |
| Custom endpoints (added by your admin) | the admin's choice | the admin's choice |

A custom endpoint shows "Added by your admin · <host>" wherever you type a key for it, and may not need a key at all. Proton's Lumo has no public API today, so it is not built in; an administrator can add it as a custom endpoint if Proton ships an OpenAI-compatible API.

## What is sent, and when

Only when you press an AI button, and only to the active provider: the entry text (up to 5,000 characters) with your guidance for a review; recently studied words and the openings of your last entries for topic ideas; for each conversation turn your new message, the last 12 messages, the topic, your level, your guidance and up to 40 of your most recently studied words (never your whole deck); or one re-encoded photo for a transcription. Nothing is sent when you open the page or pick a photo. If a reply is not valid in the expected shape, the server asks once more (a second counted call), and otherwise reports a bad reply; nothing from a malformed reply reaches the page.

## Limits

30 provider calls per user and rolling hour across all providers (checking a key, a repeated request and every conversation turn count), one AI call in flight per user, 5,000 characters per review, 1,000 characters per conversation message, 50 messages per conversation, 20 open conversations per workspace, 10 MiB and 25 megapixels per photo, at most 10 pending photos and 30 uploads per user and hour, 60 offline reads per user and hour, replies capped at 8 MiB and 150 seconds per call. When the hourly limit is used up the page says "You have used all AI calls for this hour. Try again in …".

## Provider notes

The code marks these as unverified against the providers' own documentation (`UNVERIFIED 2026-11-15` in `server/internal/ai/registry.go`): the REST field Gemini uses for the JSON schema, whether `mistral-small-latest` and `openrouter/auto` read photos, and whether Mistral accepts the OpenAI-style image object (its docs show a plain string). If a provider misbehaves, try another or report it. The owner's real-key checklist, with the documentation pages checked on 2026-11-15, is in `docs/superpowers/handoffs/2026-11-15-ai-providers-handoff.md`.

## For administrators

What the server owner decides (the secret, allowed providers, custom endpoints, limits, offline OCR) is on [AI providers and offline OCR](Admin-AI-and-OCR); the summary below is for quick reference.

### Which providers users may choose

`QINQIN_AI_PROVIDERS` is a comma list of the built-in ids (`anthropic`, `openai`, `gemini`, `deepseek`, `mistral`, `xai`, `groq`, `openrouter`) and `custom`; unset means all. A disabled provider's stored keys stay (shown "Turned off by the server", Remove only) and a selection on it reads as unavailable. The legacy `QINQIN_AI_PROVIDER=anthropic` now means `QINQIN_AI_PROVIDERS=anthropic` (a log line says so), so an upgrade never sends text to a provider you did not allow; `fake` is a test provider that never leaves the server and shows as "Test provider — no real AI". See [Environment variables](Admin-environment-variables).

### Custom AI endpoints

An administrator registers an OpenAI-compatible endpoint (Ollama, LM Studio, vLLM, Together, a company gateway, Azure-style gateways, Cohere's compatibility API) in **Settings → AI → Custom endpoints**: name, base URL, default model, whether it **Needs an API key**, and the **Structured mode** (JSON schema if the endpoint supports it, JSON mode, which works almost everywhere and is the default, or prompt only). Everyone on the server can then store their own key for it. Removing an endpoint removes everyone's keys for it.

Because any user can trigger calls to it, the server treats the address as untrusted:

- It must be `https`, without a user name, query or fragment. Plain `http` is allowed only with `QINQIN_AI_ALLOW_PRIVATE=1`, and then only for an address that resolves to a loopback or private network (for example `http://ollama:11434/v1` on a Docker network). Without that variable private addresses are refused ("Private network addresses are off on this server"); with it, every admin's endpoints can reach your LAN, so enable it only if you trust every admin.
- The address actually dialled is checked after DNS, so a hostname that resolves to a blocked address is refused, rebinding included. Link-local, cloud-metadata, multicast and unspecified addresses are never allowed.
- Redirects are not followed, so a key never travels to another host. Custom endpoints never use an HTTP proxy (the check needs the dialled address); the built-in providers honour `HTTPS_PROXY` and follow no redirects either.
- The name, address and "needs a key" setting cannot be changed later (remove and re-add), and a name may not look like a built-in provider, so an endpoint cannot pose as "OpenAI" to collect keys.

### Key storage

Each key is encrypted at rest (AES-256-GCM, bound to the user and the provider; a custom endpoint's key also to the endpoint's address) with `QINQIN_SECRET`. Keys are never returned by the API, written to logs, or included in sync or backups. A key opens only for the provider it was stored for.

### Server secret

Set `QINQIN_SECRET` to 32 random bytes, base64 encoded (standard or URL form, padded or not), to allow storing keys:

```sh
head -c 32 /dev/urandom | base64
```

Without a valid secret the server still starts, AI shows as disabled with the reason (not set, or not 32 bytes of base64), and no key can be stored. The secret also seals the mail password and the authenticator secrets: without it a mail password cannot be stored and authenticator apps are unavailable (recovery codes still work).

Back up `QINQIN_SECRET` separately from `/data`; it is never written there, and without it stored keys cannot be read and users must enter them again. To rotate it, move the old value to `QINQIN_SECRET_PREVIOUS` for one restart: on startup the keys sealed with the previous secret are re-encrypted with the new one, after which the previous value can be removed. A key sealed with a secret the server no longer knows shows as "Enter the key again" instead of failing. See [Email and security](Admin-email-and-security) and [Backup and recovery](Admin-backup-and-recovery).

### Offline OCR

The published image bundles Tesseract 5 with the Chinese Simplified and Traditional, Japanese and English standard models (`chi_sim`, `chi_tra`, `jpn`, `eng`). Chinese uses `chi_sim+chi_tra`, Japanese `jpn` and the Latin-script workspace languages `eng`; other languages have no offline reading. The Alpine packages ship no vertical Japanese model (`jpn_vert`).

- Tesseract runs with fixed arguments and no shell, 60 seconds at most per photo, at most 2 processes at once server-wide (a third request waits 5 seconds, then gets "busy"), and at most 60 offline reads per user and hour.
- Without the `tesseract` binary the server starts and logs `offline OCR: not available (tesseract not found)`, and the page shows **Read offline** as unavailable. That is normal in local development unless you install `tesseract` and the models yourself. `QINQIN_TESSERACT` points to another binary; `TESSDATA_PREFIX` is passed through.
- The OCR packages add about 193 MB to the image; the standard models were chosen over the smaller `tessdata_fast` ones for accuracy on handwriting and small print. Build with `docker build --build-arg WITH_OCR=0 .` to leave them out: offline reading then shows as unavailable and AI reading is unaffected. See [Deploying](Admin-deploying).

### Photo routes

All need a bearer token; a foreign workspace or photo is a 404.

| Route | Meaning |
|---|---|
| `POST /api/journal/photos` | multipart `file` and `workspace`; JPEG, PNG or WebP (sniffed), up to 10 MiB and 25 megapixels. Re-encoded to JPEG (EXIF rotation applied, GPS and all metadata dropped, long edge at most 2576 px, at most 3.75 MB so it stays under the providers' 5 MB after base64). 201 `{photoId}`; 413 `photo_too_large`, 415 `unsupported_image`, 422 `image_too_large`, 409 `too_many_photos` (10 pending per user), 429 `rate_limited` (30 uploads per user and hour) |
| `GET /api/journal/photos/{id}` | the stored JPEG (`no-store`) |
| `PUT /api/journal/photos/{id}/keepalive` | 204; keeps an open draft's photo alive |
| `DELETE /api/journal/photos/{id}` | 204 |
| `POST /api/journal/transcribe` | `{workspaceId, photoId, engine: "ai"\|"offline"}` → `{text, engine, unreadable}`. `ai` sends the stored photo to the provider with the user's key (it counts toward the 30 calls per hour); `offline` runs Tesseract. Neither stores anything beyond refreshing the photo's last-seen time. 409 `ocr_language_missing` or `ocr_unavailable`, 503 `busy`, 429 `rate_limited` |

A photo is deleted when its draft is saved or discarded, when its workspace is deleted, and by a janitor (at startup and every 15 minutes) when it was not seen for an hour or is over 24 hours old. The janitor also removes files without a row and rows without a file. Every route: [API routes](API-Routes).
