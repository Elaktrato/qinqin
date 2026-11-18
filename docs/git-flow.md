# Git Flow

This repository uses [git-flow](https://github.com/petervanderdoes/gitflow-avh)
(AVH edition), with `main` as production and `develop` as the integration branch.

## Branches

| Branch | Purpose |
|---|---|
| `main` | Production. Every commit is a released state; releases are tagged `vX.Y.Z`. Never commit here directly. |
| `develop` | Integration. All finished features land here. |
| `feature/<name>` | One feature or change. Branched from `develop`, finished back into `develop`. |
| `release/<version>` | Release stabilization. Branched from `develop`, finished into `main` (+ tag) and back into `develop`. |
| `hotfix/<version>` | Emergency production fix. Branched from `main`, finished into `main` (+ tag) and back into `develop`. |
| `support/<name>` | Long-lived maintenance branches (rarely needed). |

## Day-to-day

```bash
git flow feature start my-change   # branch from develop
# ... commits ...
git flow feature finish my-change  # merge --no-ff into develop, delete the branch
git push origin develop
```

## Release

```bash
git flow release start 0.1.0       # branch from develop
# version bumps / final fixes only
git flow release finish 0.1.0      # merge into main, tag v0.1.0, merge back into develop
git push origin main develop --tags
```

## Hotfix

```bash
git flow hotfix start 0.1.1        # branch from main
# fix
git flow hotfix finish 0.1.1       # merge into main, tag v0.1.1, merge back into develop
git push origin main develop --tags
```

## CI/CD mapping

- Every push to `develop` and every PR into `develop`/`main`: source and archive checks, web check/tests, Go vet + tests, web build and the embed smoke test (`scripts/smoke-embed.sh`).
- Pushes to `main` and `v*` tags: tests, then build and push the Docker image to GHCR
  (`latest` from `main`, version tags from releases).
- `v*` tags, once the image is pushed: a GitHub Release named `qinqin <tag>` is created automatically
  (the `release` job of `.github/workflows/build.yml`). Its notes are `docs/releases/<tag>.md` when that
  file exists, otherwise GitHub's generated notes; a tag with a hyphen (`v0.5.0-rc1`) becomes a
  pre-release, and re-running the job for a tag that already has a release changes nothing. To write
  the notes yourself, commit `docs/releases/<tag>.md` before the tag is pushed.
- `develop` pushes never publish images.
- Pushes to `main` that touch `docs/wiki/`, and a manual run from any branch, publish the wiki
  (`.github/workflows/wiki.yml`; see `docs/wiki/README.md`).

## Repository settings

Merge commits only (no squash/rebase) so git-flow's merge topology — and its
ability to merge releases back into `develop` — stays intact. Head branches are
deleted automatically after merge.
