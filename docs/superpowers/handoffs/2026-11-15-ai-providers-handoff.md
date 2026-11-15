# AI providers: the owner's real-key checklist (issue #87)

Everything on `feature/ai-providers` was built and checked against fake servers
(`httptest`, `server/internal/ai/aitest`, `server/tools/fakeai`). No real
provider was ever called. This list is what only a real key can confirm.

## For each provider you have a key for

In Settings → AI: add the key (it is checked with one call), press **Test key**,
make it **Active**, then in the Journal run **Review**, **Ideas** and, for models
that read photos, **Read with AI** on a photo of handwriting. Then check:

1. The review shows "Answered by <model> · <provider>".
2. Settings → AI shows this hour's calls going up by one per action (two when a
   reply needed a repair: look at the usage line).
3. The container log has no key and no entry text (`docker logs <container>`).

| Provider | Default model | What this run confirms (UNVERIFIED items; see the appendix for what the docs already settle) |
|---|---|---|
| Anthropic | `claude-opus-5-5` | Nothing new, but the adapter now uses the guarded HTTP client: confirm a normal review still works, also behind `HTTPS_PROXY` if you use one. |
| OpenAI | `gpt-6-astra` | `GET /models` lists the model you pick (key validation); strict `json_schema` accepted. Base64 `data:` image URLs and the id `gpt-6-luna` (text and image input) are now confirmed from OpenAI's docs; try `gpt-6-luna` for Read with AI too. |
| Google Gemini | `gemini-3.8-flash` | **Still UNVERIFIED:** the REST field `generationConfig.responseJsonSchema` (with `responseMimeType: application/json`). If Review answers "bad request" (`provider=gemini status=400`), this is the first suspect: the docs' own REST example uses `generationConfig.responseFormat.text` with `mimeType: "APPLICATION_JSON"` and `schema` instead (see the appendix). `GET /models/{model}` validation and photo reading via `inlineData` are confirmed from the reference. |
| DeepSeek | `deepseek-flash` | `GET /models` is now confirmed from DeepSeek's docs (key validation); empty or whitespace replies are repaired; `deepseek-v4-pro` must show "can't read photos" and offer offline reading. |
| Mistral | `mistral-large-latest` | The ids are confirmed (aliases of Mistral Large 4 / Small 4). Still open: key validation, because `/v1/models` cards carry `aliases` and our check matches `id` only (if "model not available" appears for a `-latest` id, that is why); whether `mistral-small-latest` reads photos; whether the OpenAI-style `image_url: {url}` object is accepted (Mistral's docs show a plain string). Non-strict `json_schema`. |
| xAI | `grok-4.7` | Strict `json_schema`; photo reading (`grok-4.7` is documented as "text, image → text", so Read with AI should work; xAI calls Chat Completions "a legacy endpoint"). |
| Groq | `openai/gpt-oss-120b` | Non-strict `json_schema` on this model; Read with AI must be unavailable ("can't read photos"). |
| OpenRouter | `openrouter/auto` | Key validation by a one-token chat call (the `/models` list needs no key and proves nothing); `provider.require_parameters` is documented; still open: whether the routed model reads photos and honours `json_schema`. |

## Custom endpoint

1. As admin, Settings → AI → Custom endpoints: add your Ollama or gateway.
   A private address needs `QINQIN_AI_ALLOW_PRIVATE=1` on the server; without it
   the form says so. `http://169.254.169.254/` must always be refused.
2. As a second (non-admin) user, store a key for it ("Added by your admin · host"
   is shown), make it active and run a Review.
3. Note which structured mode worked (JSON mode is the default; try JSON schema
   if your endpoint supports it).

## Operator checks

- `QINQIN_AI_PROVIDERS=anthropic,custom`: other providers disappear from the
  picker; a user with an OpenAI key sees it as "Turned off by the server".
- An explicit `QINQIN_AI_PROVIDER=anthropic` logs the hint and limits AI to Anthropic.
- Lumo (Proton) has no public API; add it as a custom endpoint if one appears.

## If something fails

The errors never include your key. The log line says `kind`, `provider`, HTTP
status and our code only, for example `ai: review provider=gemini status=400 code=bad_request`.
Note that line and the provider; the fix is usually one field in
`server/internal/ai/registry.go`.

## Appendix: documentation check (2026-11-15)

Each item marked `UNVERIFIED 2026-11-15` was checked against the provider's own
documentation on 2026-11-15. No provider API was called. The quotes come through a
summarising fetch tool, so some are close paraphrases (marked ≈). No code change
was needed: the docs show no field the adapters send as wrong. One test was added:
`TestDeepSeekValidateDocsList`, using the list shape from DeepSeek's docs.

| Item | Result | Source (checked 2026-11-15) | What the docs say |
|---|---|---|---|
| OpenAI `gpt-6-luna` id | confirmed | https://developers.openai.com/api/docs/models and https://developers.openai.com/api/docs/models/gpt-6-luna | Listed as Model ID `gpt-6-luna`, "Our most efficient model for focused, high-volume tasks"; "Input modalities: text, image"; Chat Completions `v1/chat/completions` "Supported"; `structured_outputs` supported; "128,000 max output tokens". |
| OpenAI base64 `data:` image URLs (Chat Completions) | confirmed | https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create and https://developers.openai.com/api/docs/guides/images-vision | `image_url.url`: "Either a URL of the image or the base64 encoded image data." The vision guide shows the form `data:image/jpeg;base64,{base64_image}` ("By providing an image as a Base64-encoded data URL"). JPEG is a supported format. |
| Gemini `generationConfig.responseJsonSchema` | **still UNVERIFIED** | https://aistudio.google.com/api-reference/generate-content and https://aistudio.google.com/docs/structured-output?generate-content=true | The reference lists `responseMimeType` ("`application/json`" allowed) and `responseJsonSchema` in GenerationConfig and does not mark either deprecated, but the text for the schema field is circular (≈"An internal detail. Use `responseJsonSchema` rather than this field"). The structured-output guide's REST example posts to `/v1beta/models/{model}:generateContent` with `generationConfig.responseFormat.text` = `{"mimeType": "APPLICATION_JSON", "schema": {…}}`, and says "set `response_json_schema` (or `responseFormat.text.schema` in REST)". A search summary reported that Google's Agent Platform (Vertex) reference calls the field deprecated in favour of `response_format`; that is not the Gemini Developer API page and was not read directly. Ambiguous, so the code stays as it is. Fallback if 400: send `responseFormat.text` instead. |
| Gemini inline image part | confirmed | https://aistudio.google.com/api-reference/generate-content and https://aistudio.google.com/docs/image-understanding?generate-content=true | Content `parts`: `inlineData` (`Blob`, "Inline media bytes") with `mimeType` and `data` ("Raw bytes for media formats"). The SDK examples use `inlineData`/`mimeType`; the curl example uses the snake_case spelling `inline_data`/`mime_type`. Inline data limits the whole request to 20 MB. |
| Gemini single-model lookup (key validation) | confirmed | https://aistudio.google.com/api-reference/models | "GET `/v1beta/models/{model}`": "Gets information about a specific Model such as its version number, token limits, parameters and other metadata." |
| Gemini finish and block reasons, usage fields | confirmed | https://aistudio.google.com/api-reference/generate-content | `finishReason` includes STOP, MAX_TOKENS, SAFETY, RECITATION, BLOCKLIST, PROHIBITED_CONTENT, SPII, IMAGE_SAFETY (plus LANGUAGE, OTHER, MALFORMED_RESPONSE and image/tool reasons we do not treat as refusals); `promptFeedback.blockReason`: "If set, the prompt was blocked and no candidates are returned"; `usageMetadata` `promptTokenCount`, `candidatesTokenCount`, `thoughtsTokenCount`, `cachedContentTokenCount`; `modelVersion`. |
| Gemini model ids | confirmed | https://aistudio.google.com/docs/models | `gemini-3.8-flash` and `gemini-3.5-flash-lite` are listed as Stable. (Newer `gemini-4-*` models also exist.) |
| DeepSeek `/models` | confirmed | https://api-docs.deepseek.com/api/list-models | `GET /models`: "Lists the currently available models, and provides metadata about each one"; example `"object": "list"` with `data[].id` `deepseek-flash` and `deepseek-v4-pro`. |
| Mistral `mistral-large-latest`, `mistral-small-latest` ids | confirmed | https://docs.mistral.ai/inference/conversations/function-calling | Available-models table: "Mistral Large 4 – `mistral-large-latest`", "Mistral Small 4 – `mistral-small-latest`". |
| Mistral Large vision | confirmed | https://docs.mistral.ai/models/mistral-large-4-0 | "a state-of-the-art, open-weight, general-purpose multimodal model" with "a 1.6B vision encoder". |
| Mistral Small vision | **still UNVERIFIED** | https://docs.mistral.ai/models/mistral-small-4-0-26-03 and https://docs.mistral.ai/studio/conversations/vision | The Small 4 card shows modality icons only. The vision guide lists `mistral-small-2506` (Small 3.2) as a vision model, while its Python image example uses `model = "mistral-small-latest"`. |
| Mistral image part shape | **UNVERIFIED (new)** | https://docs.mistral.ai/studio/conversations/vision | The examples use `"image_url": "https://…"` (a plain string). We send the OpenAI object `{"url": "data:…"}`; the docs neither show nor forbid it, and the base64 tab was not readable. |
| Mistral `/v1/models` | endpoint confirmed, matching **UNVERIFIED (new)** | https://docs.mistral.ai/api/endpoint/models | "GET /v1/models": "List all models available to the user"; the schema is `object: "list"` with a `data` array of model cards, but the example is a bare array, and each card has `id` and `aliases`. Our check compares `id` only, so a `-latest` alias that appears only in `aliases` would fail as "model not available". |
| xAI `grok-4.7` vision | confirmed | https://docs.x.ai/developers/models/grok-4.7 and https://docs.x.ai/docs/guides/chat-completions | "text, image → text", structured outputs supported. Chat Completions shows `"type": "image_url"` with an `image_url` object holding `url` (a public URL or `data:image/jpeg;base64,…`) and `detail`; "Chat Completions is offered as a legacy endpoint." Images: jpg/jpeg or png, up to 20 MiB. |
| OpenRouter `provider.require_parameters` | confirmed | https://openrouter.ai/docs/features/provider-routing and https://openrouter.ai/docs/features/structured-outputs | "Only use providers that support all parameters in your request" (default false); structured outputs: "Support is determined per endpoint, not just per model … Set `require_parameters: true` in your provider preferences." |
| OpenRouter `openrouter/auto` vision and structured routing | **still UNVERIFIED** | https://openrouter.ai/docs/features/model-routing | The auto router rates each request on aspects including "whether it needs vision or knowledge of a codebase", and "the request goes through the same provider routing a direct request to that model would". It says nothing about `response_format` or a guarantee that an image request reaches a vision model. |
| Ollama `json_schema` on `/v1` (custom endpoint) | confirmed (≈) | https://docs.ollama.com/capabilities/structured-outputs and https://docs.ollama.com/api/openai-compatibility | "Structured outputs work through the OpenAI-compatible API via `response_format`"; the compatibility page ticks `response_format`, JSON mode and "Base64 encoded image" (image URLs are not supported). No `json_schema` example is shown, so the mode is still worth a real try. |

