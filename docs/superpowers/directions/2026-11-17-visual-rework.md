# Visual rework — direction

Date: 2026-11-17. Epic [#95](https://github.com/Elaktrato/qinqin/issues/95), sub-issues #96–#106 (#107 owner
drawings and #108 house theme stay open and are the owner's). **No merge to `main`, no tag, no release.** The
v0.4.0 prep run is merged on `develop` (handoff `2026-11-17-v0.4.0-prep-handoff.md`).

Source of truth: `docs/superpowers/specs/2026-11-16-visual-rework-design.md` (approved) and the mockups
`docs/superpowers/specs/assets/2026-11-16-visual-rework-mockups.html` (the `THEMES` object holds the palette
values; the mockups load Google Fonts, the app must not).

Ruling: the design and mockups were only on the remote branch `origin/ccr-021a511a-kj8k4p` (two docs commits, not
on `develop`); they are brought onto the collection branch unchanged — why: the brief names them as the source of
truth and the branch contains nothing else — cost if wrong: none (docs only).

## Process

- Collection branch `feature/visual-rework` from `develop`; one topic branch per issue
  (`feature/vr-<name>`) in its own worktree, merged `--no-ff` into the collection branch; the collection branch is
  merged `--no-ff` into `develop` when an item is done, all gates are green and CI on that `develop` commit is
  green. Never force-push or rewrite history.
- Per item: plan (`docs/superpowers/plans/`, small test-first tasks, exact files, gates, review focus, empty
  Execution record) → test-first build, one commit per task → independent review on the strongest model → one fix
  wave → merge → CI green → comment on and close the issue → update `docs/ROADMAP.md`.
- Every non-obvious decision: `Ruling: <what> — <why> — <cost if wrong>`. Design vs code disagreements: follow
  the design's intent, record a Ruling, do not ask.
- Licensing first: verify the licence of every palette (#96) and every font (#97) before bundling; credit each on
  the Sources page; only free-to-use fonts (SIL OFL, MIT), self-hosted, never a third-party host at runtime.
- New shared rules (theme files, derived tokens, appearance row, widget-options row) get `docs/contracts/`
  folders with fixtures decoded by Go and web tests. All new strings go through the message catalogues (#73).
- Visual checks: Playwright/Chromium is permitted for this run (owner's brief): screenshots of pages at 360, 1024
  and 1440 px in a light and a dark theme, compared with the mockups; scratch screenshots are deleted afterwards.
- Accessibility behaviour (skip link, focus, live regions, reduced motion, forced colours, screen-reader text) and
  every existing test stay green.

## Order

#96 theme packs and appearance → #97 fonts → #98 base components and rules → #99 frame → #100 home and heatmap
layouts → #101 flashcards → #102 reader → #103 journal (incl. `kind`) → #104 search and entry → #105 stats →
#106 remaining pages. The flower drawings (#107) and the house theme (#108) are the owner's; the heatmap ships
with tint-only tiles.

## Finish

`docs/superpowers/handoffs/<date>-visual-rework-handoff.md` (what shipped with merge commits; what the owner
must check by hand — every page at phone and desktop width, light and dark, at least three themes; rulings and
what is left open) with a short before/after gallery under `docs/superpowers/handoffs/assets/`; update
`docs/ROADMAP.md`; leave `develop` pushed and green.
