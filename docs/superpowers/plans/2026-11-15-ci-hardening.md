# CI and serving hardening (#54, #20, #21, #22)

Branch `feature/ci-hardening`. One commit per issue/sub-task.

1. #54 Bump actions to current majors (checkout v7, setup-node v7, setup-go v7,
   docker setup-buildx v4, login v4, metadata v6, build-push v7). Release notes
   read: the breaking changes are the Node 24 runtime (runner >= 2.327.1, fine on
   ubuntu-latest) and removed deprecated inputs/envs we do not use. Validate with actionlint.
2. #20 Static serving (Go tests first): cache headers, nosniff, font MIME,
   `/healthz/`, directory request, I/O error -> 500, stub API in main_test,
   split vitest config, `.dockerignore` env files.
3. #21 Docs accuracy: README, Sources page wording, docs/sources.md.
4. #22 `scripts/smoke-embed.sh` (real embed through the built binary), archive
   integrity, SHA-256 manifest for fetch-seeds downloads, CI wiring, manual
   pre-release browser checklist in docs/.

Rulings are recorded in the final report and in commit bodies.
