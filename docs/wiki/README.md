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

## Publishing from CI

The workflow `.github/workflows/wiki.yml` publishes this folder to `<repo>.wiki.git`:

- on every push to `main` that changes `docs/wiki/`;
- by hand: Actions, wiki, **Run workflow** (`workflow_dispatch`) publishes the `docs/wiki/` of the branch it is started on, so the owner can publish from `develop` or a docs branch.

It clones the wiki repository, copies the folder in with `rsync --delete` (leaving out `README.md`), and commits and pushes only when something changed ("docs: update wiki from docs/wiki at <sha> (<branch>)").

One-time setup:

1. The owner enables the wiki in the repository settings (Features, Wikis) and creates the first page in the web UI once. GitHub cannot create it through the API.
2. Create a **classic personal access token with the `public_repo` scope** (the repository is public) and store it as the repository secret `WIKI_TOKEN` (Settings, Secrets and variables, Actions). Never write it into a file. That is the dependable choice: fine-grained tokens and GitHub App installation tokens are reported to be refused by the wiki remote even with Contents write (not verified here), so if a push fails with 403 or "not found", switch to a classic token.

Without `WIKI_TOKEN` the job prints a notice ("Wiki not published") and succeeds without publishing, so a missing secret never fails a build. Add the secret, then run the workflow again.

## Conventions

- One page per file; the file name is the page name (`Getting-started.md` is `Getting started`).
- Links between pages are standard Markdown links without extension: `[text](Page-name)`.
- No images: the pages describe the interface in words.
- `API-Routes.md` and `API-Errors.md` are generated. After a route or an error code changes run `node scripts/gen-api-docs.mjs`; `node scripts/gen-api-docs.mjs --check` (and the tests) fail when the committed pages are stale.
- Every page file must be linked from `_Sidebar.md`, and every link in the sidebar must exist (checked by `apps/web/src/lib/wikiDocs.test.ts`).
