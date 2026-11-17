# Visual rework — takeover handoff (paused after #102)

Written 2026-11-17 when the owner paused the run after #102. The visual rework (epic #95, sub-issues #96–#106) is
**half built**: #96–#98 are on `develop` (pushed, CI green); #99–#102 are built, merged into the collection branch
`feature/visual-rework` but **not yet on `develop`** (#99 and #100 are reviewed with fix waves; **#101 and #102 are
not yet independently reviewed**); #103–#106 are planned but **not built**. This file is the brief for the agent that
takes over: read it completely, then the documents it names, then continue with section 4.

**Do not merge to `main`, tag or release.** #107 (owner's flower/level/day-marker drawings) and #108 (house
theme) are the owner's: leave them open; the heatmap ships with tint-only tiles. No Android code.

## 1. Read first

1. `docs/superpowers/directions/2026-11-17-visual-rework.md` (process, order, finish) and
   `docs/superpowers/directions/2026-11-17-visual-rework-prep-run-additions.md` (43-row audit of UI features added by
   the earlier v0.4.0 prep run that the design predates; rulings R1–R10; mockup-vs-app drift; six owner checks).
2. `docs/superpowers/specs/2026-11-16-visual-rework-design.md` (approved, source of truth) and the mockups
   `docs/superpowers/specs/assets/2026-11-16-visual-rework-mockups.html` (static HTML; its `THEMES` object holds
   palette values; it loads Google Fonts — the app must not).
3. The plan of the item you build (`docs/superpowers/plans/2026-11-17-vr-<name>.md`) **including its Execution
   record and its "Adaptations to the prep run" section**, and the Execution records of the finished items (they say
   what was actually built and why): `vr-themes`, `vr-fonts`, `vr-base`, `vr-frame`, `vr-home`, `vr-flashcards`,
   `vr-reader`.
4. `docs/superpowers/handoffs/2026-11-17-v0.4.0-prep-handoff.md` (the run before this one), `docs/contracts/overview.md`,
   `README.md`, `docs/git-flow.md`.

## 2. State of the branches

- Collection branch: `feature/visual-rework` (local worktree `.claude/worktrees/vr-collect`; pushed to `origin` at
  the pause so it survives). It contains everything below and the current `develop` (`4675f585`).
- `develop` = `4675f585`, CI green: #96 themes, #97 fonts, #98 base components + token migration, the **blank-page build
  fix**, and the **study-session loop fix** (see §3). Nothing of #99–#102 is on `develop` yet.
- All `feature/vr-*` topic branches are merged into the collection branch; their worktrees under
  `.claude/worktrees/` can be removed (`git worktree list`; two are nested inside `vr-collect/.claude/worktrees/`
  because they were created from the wrong directory). Plans for #103–#106 are on the collection branch.
- Untracked `apps/web/static/hanzi/` in the main checkout is a stale leftover of the old stroke bundle (gitignored
  entry was removed with the strokes pack work); it makes `bundleSize.test.ts` fail **in the main checkout only**
  (worktrees are clean). Safe to delete.

| # | Item | State | Merge on collection branch | Plan / Execution record |
|---|---|---|---|---|
| 96 | Theme packs and appearance | on `develop`, issue closed | `9cea716` | `vr-themes` |
| 97 | Fonts (Figtree, font packs, hanzi font) | on `develop`, issue closed | `9cea716` | `vr-fonts` |
| 98 | Base components + token migration | on `develop`, issue closed | `9cea716` | `vr-base` |
| 99 | App frame (top bar, drawer, menus) | built + reviewed + fixed, **not on develop** | `58bf008` | `vr-frame` |
| 100 | Home + three heatmap layouts | built + reviewed + fixed, **not on develop** | `164ef42d` | `vr-home` |
| 101 | Flashcards open page, grade bar with intervals | built, **no independent review yet** | `6f520397` | `vr-flashcards` |
| 102 | Reader rail, word marks, lookup popup/sheet | built, **no independent review yet** | `105ddc7d` | `vr-reader` |
| 103 | Journal (3 columns, margin corrections, `kind`) | plan only | — | `vr-journal` |
| 104 | Search master–detail + entry page | plan only | — | `vr-search-entry` |
| 105 | Stats (Overview/Characters/Week) | plan only | — | `vr-stats` |
| 106 | Remaining pages | plan only | — | `vr-pages` |

Baseline gates on the collection head at the pause are recorded in §7 (filled in by the pausing agent).

## 3. Things you must know

- **v0.3.0 has two serious bugs, both already fixed on `develop`, not on `main`**: (1) every plain `npm run build`
  produced an `index.html` whose `__sveltekit_<hash>` global differed from the chunks (blank page; the Dockerfile and
  CI run a plain build; fixed by `5c34a95`, one build id per build). (2) The study session never loads (infinite
  pull/events loop since commit `e55daecc`, personal notes, v0.3.0 stretch; fixed by `4675f585`, only the workspace is
  tracked in the load effect). Whether to cut a v0.3.1 hotfix from `main` is the **owner's decision** — not made.
- A real browser caught both; unit tests did not. **Use Playwright for the visual check task of every item** (see §6).
- The design predates the v0.4.0 prep run; its results (milestones card, Settings → Features, Data/packages, interface
  language, admin re-authentication dialogs, kana display forms, API errors by code, logo/favicon) are accounted for in
  the additions doc. Follow it.
- Contract changes made so far: `docs/contracts/themes/` (derivation incl. `readableBad`, `readableMuted`,
  `readableGrades`, `highlights`, `focusRing`; 40 tokens), `docs/contracts/fonts/`, `widget-options` row,
  `scheduler/next-intervals.json` + `interval-text.json`, `goals/flower-stages.json`, lookup `levels` field.
  Changing the token list makes every device show one Latte/Mocha first paint after upgrade (stored tokens go stale).
- Single `<main id="main-content">` landmark belongs to the frame; pages use `<div class="page-body">`
  (`routes/mainLandmark.test.ts` enforces it). Pages set their phone title/actions with `setFrameTitle` /
  `setPageActions` from `$lib/frame/pageFrame.svelte`; breakpoint is `$lib/frame/breakpoint` (720px).
- Lints that must stay green: colour literals / `prefers-color-scheme` / faded-text opacity / focus ring / hard-coded
  strings / literal `lang` / one-main. Allowlist entries need a reason and a count.
- Process deviations to be aware of (history is not rewritten): the #99 builder amended its own unpushed record
  commit; the #101 merge commit lacks the Co-Authored-By trailer; three small "fix forward" commits exist in #102.

## 4. What is left, in order

1. **Review #101 and #102** (independent review on the strongest model; focus per plan "Review focus"; include
   Playwright-measured contrast over the built-in themes for grade names, word marks, chips; forced colours; reduced
   motion), **one fix wave each**, merge fixes into the collection branch.
2. **Merge #99–#102 to `develop`**: full gates on the merged tree (§5), merge the collection branch `--no-ff` into
   `develop`, push, **wait for CI green**, comment on and close #99–#102 (pattern: see closed #96–#98 comments).
3. **Build #103** (journal; includes the `kind` field = Go + AI review schema + prompt change; security review focus:
   prompt injection through entry text, untrusted provider output rendered as text only), **#104** (search master–detail,
   shared `EntryView`, lookup `glosses`/`levels` on search hits, characters on entries), **#105** (stats; new `Select`
   base component; summary-numbers and reviews-per-day widgets; `docs/contracts/stats/`; commits three README stats
   screenshots), **#106** (every remaining route per the route-guard test; per-page checklist; 7 layout questions →
   Rulings + owner checks; writes the README gallery section and commits Home, session, reader, journal, search+entry,
   phone drawer, decks, Appearance and sign-in screenshots under `docs/assets/screenshots/`). Each: build → independent
   review → one fix wave → merge → gates → `develop` → CI → close the issue.
4. **README screenshots (explicit owner request):** the README must show how the app now looks with each feature
   (home + heatmap layouts, flashcards, reader, journal, search/entry, stats, Settings → Appearance with themes, phone
   drawer, sign-in), light and dark, compressed (each well under ~200 kB, PNG or WebP), referenced from README with
   alt text; a doc test keeps README and files in agreement. The #105/#106 plans list the exact files.
5. **Finish** (`docs/superpowers/directions/2026-11-17-visual-rework.md` §Finish):
   `docs/superpowers/handoffs/<date>-visual-rework-handoff.md` in the format of the earlier handoffs — what shipped
   with merge commits; what the owner must check by hand (every page at phone and desktop width, light and dark, at
   least three themes); rulings; what is left open — plus a short before/after gallery under
   `docs/superpowers/handoffs/assets/`; update `docs/ROADMAP.md`; leave `develop` pushed and green.

## 5. Process (as in the earlier runs)

- Per item: plan exists → test-first build, one commit per task (see each new test fail, then pass) → independent
  review (read-only reviewer, findings ranked Critical/Important/Minor with file:line and a scenario) → one fix wave
  (a second one when security findings remain) → mutation check of new tests where cheap → merge `--no-ff` into the
  collection branch → full gates → merge into `develop`, push, wait for CI → close the issue.
- Every non-obvious decision: `Ruling: <what> — <why> — <cost if wrong>`.
- Licensing first (bundle nothing whose licence is unclear; credit on the Sources page, `docs/sources.md`,
  `scripts/check-sources.mjs` rules); only free-to-use fonts, self-hosted.
- New routes: `route{}` row, deliberate token rule, 401 + two-user tests, `UPDATE_ROUTES_FIXTURE=1`, regenerate
  `docs/wiki/API-Routes.md` (`node scripts/gen-api-docs.mjs`). New shared rules get `docs/contracts/` folders with
  fixtures decoded by Go and web tests; keep `overview.md` and the contracts README table current; keep
  `docs/wiki/` and the README accurate (doc tests check them). All strings through the catalogues (`t()`, `<Msg>`).
- Commits: conventional, each message ends with a blank line and exactly
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (owner's instruction; no model names in commits, code or
  docs). Never force-push or rewrite history. At most three agents/jobs at a time on four cores; Go gates under
  `flock /tmp/qinqin-go.lock`. Gates: Go `gofmt -l .` empty + `go vet ./...` + `go test -count=1 -p 2 ./...`;
  web `npm ci`, `npm run check`, `npx vitest run`, `npm run build` (read exit codes; never run two builds in one
  worktree); `node scripts/gen-api-docs.mjs --check`, `node scripts/check-sources.mjs`, `node --test scripts/*.test.mjs`.
  Timing tests (`pwa/icons`, `weekly/perf`, `milestones/perf`, `scheduleTimeline`, reader `readings`, some dom tests)
  time out on a loaded machine and pass alone — rerun alone before calling them real.
- If you cannot spawn sub-agents, do each step yourself in the same order; the review step must still be done with
  fresh eyes (a separate read-only pass over `git diff`), and findings must be written down, not silently fixed.

## 6. Environment notes

- Nothing is on PATH. Go 1.26 and Node 26 live in `/home/user/qq-tools/` (`goroot/bin`,
  `node-v26.13.1-linux-x64/bin`); `export PATH=/home/user/qq-tools/goroot/bin:/home/user/qq-tools/node-v26.13.1-linux-x64/bin:$PATH`.
  Proxy variables must be unset for Go tests (`env -u HTTPS_PROXY -u HTTP_PROXY -u https_proxy -u http_proxy -u NO_PROXY -u no_proxy GOTOOLCHAIN=auto GOFLAGS=-buildvcs=false`).
- Playwright is a library only: `require('/home/user/qq-tools/pw/node_modules/playwright-core')`,
  `chromium.launch({executablePath:'/home/user/.cache/ms-playwright/chromium-1161/chrome-linux/chrome'})`. The owner
  permitted it for this run (their brief overrides the earlier "no local Playwright" rule); a few sub-agent launches were
  refused by the permission system — if yours is, do not work around it: record "not verified visually". Serve the
  built app with the Go binary on a free 127.0.0.1 port (not 8080, 8085, 8300) from a scratch data dir, register a user
  via the API, screenshot at 360, 1024 and 1440 px in Latte, Mocha and two more themes; delete scratch files.
- Never touch the docker container `qinqin` or `/home/user/qinqin-deploy`. Many unrelated containers run on this
  machine; leave them alone.
- GitHub: `gh` works (issue comments/close via `gh issue comment N -R Elaktrato/qinqin --body ...` and
  `gh issue close N -R Elaktrato/qinqin`); CI status via `gh run list -R Elaktrato/qinqin --branch develop`.
- An opencode instance runs on this machine; it is not reachable through the agent messaging used so far.

## 7. Baseline at the pause

Gates on the collection head `e2224a57` (Node 26.13.1, Go 1.26.11), all exit 0: Go `gofmt -l`/`vet`/`test ./...`;
`npm run check` (0 errors); full vitest 10,617 passed / 2 skipped; `npm run build`; `gen-api-docs --check`;
`check-sources`; `node --test scripts/*.test.mjs`. `develop` (`4675f585`) CI green. No red gates to inherit.

## 8. Open items and owner checks (so far)

From the additions doc: (1) "Recall" is both a card kind and the 30-day stat; (2) favicon follows the browser's
light/dark, not the app theme; (3) PWA PNG icons are still the old mark; (4) mastery stage words; (5) the mock's
"1,000 words known" milestone does not exist; (6) Data pack rows can be six lines on a phone. From the builds: Solarized
Dark with a warm accent has a faint level-1 heatmap tint (a stronger tint is a themes-contract change — owner's call);
sighted keyboard users get no per-day heatmap details (waits for #107); flower stages have no Go parity test (Android);
LXGW WenKai TC is not packed (licence unchecked); no default font pack is baked into the image (owner's call); after
"Add to deck" in the reader a popup can show the add button again until reopened (pre-existing); the Docker image has
not been built here; no real touch/screen-reader/offline-service-worker verification anywhere; the v0.3.1 hotfix
question (§3).

## 9. Takeover prompt (paste into the next agent)

> You are taking over the qinqin visual rework (github.com/Elaktrato/qinqin, epic #95) autonomously. Read
> `docs/superpowers/handoffs/2026-11-17-visual-rework-takeover.md` on the branch `feature/visual-rework` completely and
> follow it: it lists what is done, what is left (reviews of #101 and #102, merging #99–#102 to `develop`, building
> #103–#106, the README screenshots, the final handoff), the process, the environment notes and the hard rules.
> Do not merge to `main`, tag or release; no Android code; leave #107 and #108 open. Finish with
> `docs/superpowers/handoffs/<date>-visual-rework-handoff.md`, an updated `docs/ROADMAP.md`, the README screenshots, and
> `develop` pushed and green.
