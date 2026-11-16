# Journal and AI providers

The Journal is a page plugin where you write dated entries per workspace. The AI features (a review with underlined corrections, topic ideas, and turning a photo of a page into an entry) are optional. They use **your own API key** for a provider you choose; qinqin ships no key and sends nothing to any provider on its own.

> **Status.** The AI provider integrations are covered by tests against fake providers. They have **not yet been tested with real keys** by the project owner. Some provider details are marked unverified in the code (see "Provider notes" below). Expect rough edges until a real key has been tried.

## Setting up a provider

1. An administrator must have set `QINQIN_SECRET` (see [Environment variables](Admin-environment-variables)). Without it AI shows as disabled with the reason, and the rest of the app works.
2. Open Settings, AI, pick a provider and enter your key. The key is checked with the provider (one call counts toward your hourly limit), stored encrypted, and the first stored key becomes active. Only the last four characters are shown afterwards.
3. You can store one key per provider and switch the active one. You may type any model id; the list only suggests. The defaults are the providers' flagship models, which are also the most expensive: choose a cheaper model if cost matters.

Providers: Anthropic, OpenAI, Google Gemini, DeepSeek, Mistral, xAI, Groq, OpenRouter, and custom OpenAI-compatible endpoints that an administrator registers (Ollama, LM Studio, vLLM, a company gateway). The server may restrict the list (`QINQIN_AI_PROVIDERS`).

## What is sent

Only when you press an AI button, and only to the active provider: the entry text (up to 5,000 characters) and your guidance for a review; recently studied words and the openings of your last entries for topic ideas; or one re-encoded photo for a transcription. Nothing is sent when you open the page or pick a photo. The provider's terms apply.

## Features

- **Review**: underlined corrections plus an overall review of one entry. The result is stored with the entry. On Anthropic's Opus and Sonnet a safety refusal can be retried by a fallback model on your key; the review then says which model answered and marks "(fallback)".
- **Topic ideas**: suggestions from your recent words and entries.
- **Photo to entry**: choose a photo (JPEG, PNG or WebP, up to 10 MiB and 25 megapixels). It is stripped of metadata including GPS, shrunk and kept only while the draft is open. **Read with AI** sends it to your provider; **Read offline** uses Tesseract on the server and sends nothing anywhere (Chinese, Japanese and Latin-script languages; vertical Japanese is read poorly). There is no automatic fallback between the two. A model that cannot read photos makes AI reading unavailable.

## Limits

30 provider calls per user and hour across all providers (checking a key counts), one AI call in flight per user, 5,000 characters per review, at most 10 pending photos and 30 uploads per hour, 60 offline reads per hour. Settings, AI shows calls and tokens used this hour.

## Provider notes

The code marks these as unverified against the providers' own documentation: Gemini's REST field for the JSON schema, whether `mistral-small-latest` and `openrouter/auto` read photos, and whether Mistral accepts the OpenAI-style image object. If a provider misbehaves, try another or report it. The owner's real-key checklist is in `docs/superpowers/handoffs/2026-11-15-ai-providers-handoff.md`.

## Administrators

Custom endpoints, private addresses, provider restrictions and the secret are covered in [Environment variables](Admin-environment-variables) and [Email, two-step sign-in and security](Admin-email-and-security). Offline OCR needs the Tesseract binary, included in the published image.
