# The qinqin wiki source

These Markdown files are the source of the GitHub wiki. The wiki is generated from this folder: edit the files here, in the repository, and never on the wiki itself (the next publish overwrites it).

## Publishing

GitHub keeps a wiki in a separate git repository, `<repo>.wiki.git`. The wiki must have at least one page created in the web UI before that repository exists. Then:

```sh
git clone https://github.com/Elaktrato/qinqin.wiki.git /tmp/qinqin-wiki
rsync -a --delete --exclude .git --exclude README.md docs/wiki/ /tmp/qinqin-wiki/
cd /tmp/qinqin-wiki
git add -A && git commit -m "docs: update wiki from docs/wiki" && git push
```

`README.md` stays out of the wiki (it only explains this folder). `Home.md`, `_Sidebar.md` and `_Footer.md` are the special pages GitHub recognises.

## Conventions

- One page per file; the file name is the page name (`Getting-started.md` is `Getting started`).
- Links between pages are standard Markdown links without extension: `[text](Page-name)`.
- No images: the pages describe the interface in words.
- `API-Routes.md` and `API-Errors.md` are generated. After a route or an error code changes run `node scripts/gen-api-docs.mjs`; `node scripts/gen-api-docs.mjs --check` (and the tests) fail when the committed pages are stale.
- Every page file must be linked from `_Sidebar.md`, and every link in the sidebar must exist (checked by `apps/web/src/lib/wikiDocs.test.ts`).
