# Stroke-order data

How a client asks for the stroke order of one character and which installed strokes pack answers. The route
carries the data of every strokes pack (`type: strokes`, format `hanzi-writer-jsonl-gz`); the two packs the
project ships are the Chinese-and-Japanese Hanzi Writer data (`hanzi-writer-strokes`, Arphic Public License) and the
Japanese KanjiVG data (`kanjivg-strokes`, CC BY-SA 3.0, #62). Fixture: [`lookup.json`](lookup.json) (rule
`strokes/lookup`).

## The route

`GET /hanzi/U<HEX>.json[?lang=<code>]`: public, not access tokens, no credentials. `<HEX>` is the code point in upper-case
hex without leading zeros (`U597D.json`). The answer is the stored JSON of one character, byte for byte:

```
{ "strokes": ["<outline path>", ...], "medians": [[[x, y], ...], ...] }
```

in a 1024 box with y up and the baseline at 900 (Hanzi Writer's data); `strokes` and `medians` have one entry per stroke,
in stroke order. `Cache-Control: public, max-age=86400` and an `ETag` of the data; 404 when no installed pack has the
character; any other name is 404.

## `lang`: the shapes of one language

The same code point is drawn differently in Chinese and Japanese. The optional `lang` is a lower-case language
code of two or three letters (`ja`, `zh`, `ko`); a client that knows the language of what it shows passes it (the
language of the entry or the workspace). The server chooses among the packs that have the character
([`lookup.json`](lookup.json)):

1. a pack that lists the language in its manifest `languages` comes before one that does not;
2. among those, the pack with the **fewest** languages comes first (a pack made for Japanese alone beats the shared
   Chinese-and-Japanese one);
3. then the pack registered first.

A character only one pack has is served whatever the language, and a language no pack lists is the order of
registration, so a client may always pass the language of its workspace. Without `lang` the order of registration
decides (the behaviour before contract 12). A `lang` that is empty, repeated or not two or three lower-case letters is `400 bad_request`;
other query parameters are ignored.

## Client rules

- The language and the character are the cache key everywhere: the in-memory cache of the web app keys by both,
  and the service worker's `/hanzi/` cache keeps `?lang=ja` and plain answers separately (its key is the path and a
  well-formed `lang`; every other query parameter is dropped, `pwa/`).
- Strokes the pack draws as centre lines widened into outlines (KanjiVG) are indistinguishable for a client: it
  reads `strokes` for the shape and `medians` for the order and direction, as it does for any pack.
- Credits: `GET /api/stroke-packs` lists every installed strokes pack in lookup order (`packId`, `name`, `version`,
  `languages`, `license`, `attribution`, `notice`); the Sources page shows them.
