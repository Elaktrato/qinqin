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

| Provider | Default model | What this run confirms (UNVERIFIED items) |
|---|---|---|
| Anthropic | `claude-opus-5-5` | Nothing new, but the adapter now uses the guarded HTTP client: confirm a normal review still works, also behind `HTTPS_PROXY` if you use one. |
| OpenAI | `gpt-6-astra` | `GET /models` lists the model you pick (key validation); base64 `data:` image URLs in `image_url` (Read with AI); strict `json_schema` accepted. Try `gpt-6-luna` too (id UNVERIFIED). |
| Google Gemini | `gemini-3.8-flash` | The REST field `generationConfig.responseJsonSchema` is accepted (if you get "bad request", this is the first suspect); `GET /models/{model}` validation; photo reading via `inlineData`. |
| DeepSeek | `deepseek-flash` | `GET /models` exists and lists the model (else key validation says "model not available"); empty or whitespace replies are repaired; `deepseek-v4-pro` must show "can't read photos" and offer offline reading. |
| Mistral | `mistral-large-latest` | The ids `mistral-large-latest` and `mistral-small-latest`; non-strict `json_schema`; photo reading. |
| xAI | `grok-4.7` | The id; strict `json_schema`; whether it reads photos (registry says yes; if Read with AI fails with "bad request", flip `Vision` in `server/internal/ai/registry.go`). |
| Groq | `openai/gpt-oss-120b` | Non-strict `json_schema` on this model; Read with AI must be unavailable ("can't read photos"). |
| OpenRouter | `openrouter/auto` | Key validation by a one-token chat call (the `/models` list needs no key and proves nothing); `provider.require_parameters` accepted; whether the routed model reads photos. |

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
