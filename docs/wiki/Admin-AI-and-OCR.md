# AI providers and offline OCR

The AI features (the Journal's review with corrections, topic ideas, the conversation partner and reading a photo of a page, and AI example sentences on a dictionary entry) use **each user's own API key** for a provider they choose; qinqin ships none. How people use them is on [Journal and AI providers](Journal-and-AI). This page is what the server owner decides.

> **Status.** The provider integrations are tested against fake providers only; the project owner has not yet tried them with real keys. Some provider details are marked `UNVERIFIED 2026-11-15` in `server/internal/ai/registry.go` (see "Provider notes").

## What leaves the server

Only when a user presses an AI button, and only to the provider that user made active in Settings → AI: the journal entry (up to 5,000 characters) and their guidance for a review; recently studied words (at most 60) and the titles and openings of their last 10 entries for topic ideas; for a conversation turn the new message, the last 12 messages, the topic, the level, their guidance and at most 40 recently studied words; one re-encoded photo for a transcription; or, for AI examples, the word, its first reading, up to five meanings, up to ten existing examples (the learner's own saved sentences among them) and the learner's level. Photos are stripped of all metadata (including GPS) and shrunk first. Settings → AI tells the user, wherever they type a key, that this text, these messages and these photos go to that provider and that its terms apply.

**Cost.** The default models are the providers' flagship models, also the most expensive. Tell users to pick a cheaper model in Settings → AI if cost matters; calls are limited to 30 per user per rolling hour across all providers.

## The server secret

`QINQIN_SECRET` (32 random bytes, base64: `head -c 32 /dev/urandom | base64`) encrypts the stored keys (AES-256-GCM, bound to the user and the provider; a custom endpoint's key also to the endpoint's address). Keys are never returned by the API, written to logs, or included in sync or backups in plain text; only the last four characters are shown as a hint. Without a valid secret the server still starts and AI shows as disabled with the reason (not set, or not 32 bytes of base64), and no key can be stored. The same secret seals the SMTP password and the authenticator secrets.

Back it up separately from `/data`; it is never written there. Lost, users must enter their keys again. Rotation: [Backup, recovery and the command line](Admin-backup-and-recovery#rotating-qinqin_secret).

## Choosing which providers users may use

`QINQIN_AI_PROVIDERS` is a comma list of the built-in ids and `custom`; empty means all. A provider you leave out keeps its users' stored keys (shown "Turned off by the server", with only Remove), and a selection on it reads as unavailable. The legacy `QINQIN_AI_PROVIDER=anthropic` means `QINQIN_AI_PROVIDERS=anthropic`; `fake` is a test provider that never leaves the server ([Environment variables](Admin-environment-variables)).

| Provider (id) | Base URL | Default model (also suggested) | Reads photos | Structured replies |
|---|---|---|---|---|
| Anthropic (`anthropic`) | `https://api.anthropic.com` | `claude-opus-5-5` (`claude-sonnet-5-5`, `claude-haiku-5-5`) | yes | JSON schema |
| OpenAI (`openai`) | `https://api.openai.com/v1` | `gpt-6-astra` (`gpt-6-luna`) | yes | JSON schema (strict) |
| Google Gemini (`gemini`) | `https://generativelanguage.googleapis.com/v1beta` | `gemini-3.8-flash` (`gemini-3.5-flash-lite`) | yes | JSON schema |
| DeepSeek (`deepseek`) | `https://api.deepseek.com` | `deepseek-flash` (`deepseek-v4-pro`: no photos) | `deepseek-flash` only | JSON mode |
| Mistral (`mistral`) | `https://api.mistral.ai/v1` | `mistral-large-latest` (`mistral-small-latest`) | yes | JSON schema |
| xAI (`xai`) | `https://api.x.ai/v1` | `grok-4.7` | yes | JSON schema (strict) |
| Groq (`groq`) | `https://api.groq.com/openai/v1` | `openai/gpt-oss-120b` | no | JSON schema |
| OpenRouter (`openrouter`) | `https://openrouter.ai/api/v1` | `openrouter/auto` | depends on the routed model | JSON schema |
| Custom (`custom`) | the administrator's address | the administrator's choice | the administrator's choice | JSON mode by default |

Users may type any model id (1 to 200 characters of `[A-Za-z0-9._:/@-]`); the list only suggests. A model that cannot read photos makes **Read with AI** unavailable and the page offers offline reading instead. A reply that is not valid JSON of the expected shape is asked for once more (a second counted call); otherwise the user sees "bad reply" and nothing of it reaches the page. On Anthropic's Opus and Sonnet a safety refusal is retried by the provider's default fallback model on the same key; the review says which model answered and marks "(fallback)". Other providers have no fallback.

The built-in providers honour `HTTPS_PROXY` and follow no redirects. Proton's Lumo has no public API today, so it is not built in; if Proton ships an OpenAI-compatible API it can be added as a custom endpoint.

## Custom endpoints (Settings → AI → Custom endpoints)

An administrator can **Add endpoint**: an OpenAI-compatible server such as Ollama, LM Studio, vLLM, Together, a company gateway, an Azure-style gateway or Cohere's compatibility API, with a **Name** (up to 40 characters), a **Base URL**, a **Default model**, **Reads photos**, **Needs an API key**, and a **Structured mode** (JSON schema if the endpoint supports it, JSON mode, which works almost everywhere, or prompt only). Everyone on the server can then store their own key for it and sees "Added by your admin · <host>" wherever they type one. **Edit** changes the default model, photo reading and structured mode (the API also takes a token cap); the name, address and key setting cannot be changed later (remove and add again). Removing an endpoint deletes everyone's key for it.

Because any user can trigger calls to it, the server treats the address as a threat:

- It must be `https`, without a user name, query or fragment. Plain `http` is allowed only with `QINQIN_AI_ALLOW_PRIVATE=1`, and then only when the address resolves to a loopback or private address (for example `http://ollama:11434/v1` on a Docker network).
- Private addresses are refused unless `QINQIN_AI_ALLOW_PRIVATE=1` ("Private network addresses are off on this server"). Link-local, cloud-metadata, multicast and unspecified addresses are never allowed.
- The address actually dialled is checked after DNS, so a host name that resolves to a blocked address is refused, DNS rebinding included. Redirects are not followed, so a key never travels to another host. Custom endpoints never use an HTTP proxy (the check needs the dialled address).
- A name may not look like a built-in provider, so an endpoint cannot pose as "OpenAI" to collect keys.
- With `custom` missing from `QINQIN_AI_PROVIDERS` the routes answer 409 `provider_disabled`.

## Limits

30 provider calls per user per rolling hour across all providers (checking a key and a repair request count), one AI call in flight per user, 5,000 characters per review, 10 MiB and 25 megapixels per photo, at most 10 pending photos and 30 uploads per user and hour, provider replies capped at 8 MiB, 150 s per call. A review keeps running and is stored even if the browser disconnects, so the proxy needs a read timeout of at least 180 s. Settings → AI shows the calls and tokens used this hour. Call records are pruned after 7 days.

## Offline photo reading (OCR)

The published image includes Tesseract 5 with the `chi_sim`, `chi_tra`, `jpn` and `eng` standard models from Alpine's tessdata. **Read offline** runs it on the server and sends nothing anywhere; there is no automatic fallback between the AI and the offline engine.

- Chinese uses `chi_sim+chi_tra`, Japanese `jpn`, the Latin-script workspace languages `eng`. Other languages have no offline reading (409 `ocr_language_missing`). There is no vertical Japanese model (`jpn_vert`), so vertical text is read poorly.
- Tesseract runs with fixed arguments and no shell, at most 60 s per photo and 2 processes at once for the server (a third request waits 5 s, then gets 503 `busy`), and at most 60 offline reads per user and hour.
- At start the log says `offline OCR: tesseract 5.x, languages: ...`, or `offline OCR: not available (tesseract not found)`: then the route answers 409 `ocr_unavailable` and the page shows "Read offline" as unavailable. That is the normal state in local development unless you install `tesseract` and its models. `QINQIN_TESSERACT` points to another binary; `TESSDATA_PREFIX` is passed through.
- **Image size.** The OCR packages add about 193 MB. The standard models were chosen over the smaller `tessdata_fast` ones for accuracy on handwriting and small print. Build with `docker build --build-arg WITH_OCR=0 .` to leave them out: the server starts normally, offline reading is unavailable and AI reading is unaffected.

Journal photos live in `/data/journal/<user id>/` only while a draft is open. A photo is deleted when its draft is saved or discarded, when its workspace is deleted, and by a janitor (at start and every 15 minutes) when it has not been seen for an hour or is over 24 hours old; the janitor also removes files without a row and rows without a file.

## Audio in the image

The default image build (`WITH_AUDIO=1`) also bakes in the Kanji alive example-word recordings (CC BY 4.0, 10,156 Japanese clips). A build stage runs `scripts/fetch-audio-kanjialive.sh`, which downloads about 69 MB from `media.kanjialive.com` and the data repository (a warm layer cache skips it), checks pinned SHA-256 sums and fails the build on a mismatch. The image grows by about 70 MB. The `audio-stage` workflow builds only that stage on pull requests and weekly, so a break shows early. Build with `--build-arg WITH_AUDIO=0` to leave it out (also the fallback when the download is unavailable): `/opt/qinqin/audio` is then empty and `qinqin seed` still works. See `docs/sources.md`, "Audio".

## Provider notes

Not confirmed by the providers' own documentation, marked `UNVERIFIED 2026-11-15` in the code: the REST field Gemini uses for the JSON schema (`generationConfig.responseJsonSchema`), whether `mistral-small-latest` and `openrouter/auto` read photos, and whether Mistral accepts the OpenAI-style `image_url` object. Confirmed from the docs: the ids `gpt-6-luna`, `mistral-large-latest`, `mistral-small-latest` and `grok-4.7`, photo reading for `gpt-6-luna`, `mistral-large-latest` and `grok-4.7`, base64 image data URLs for OpenAI, DeepSeek's `/models` listing, and OpenRouter's `provider.require_parameters`. The owner's real-key checklist is `docs/superpowers/handoffs/2026-11-15-ai-providers-handoff.md`.

The AI and photo routes are in [API reference](API-Reference#journal-and-ai).
