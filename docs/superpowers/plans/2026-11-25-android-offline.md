# Android offline and storage (#35) Plan

> Design record and numbers: `docs/superpowers/specs/2026-11-23-android-shell-design.md`, section "Storage and
> offline measurements (#35)". Record: `docs/architecture/0010-android-shell-and-native-bridge.md`.

**Goal:** know, with numbers, whether the WebView is enough for offline use and the session token, and keep the
checks running, although the development machine cannot run an emulator (no `/dev/kvm`).

## Rulings

- Ruling: the checks run in a GitHub Actions job with an emulator, driven by `adb` and the WebView's DevTools socket
  with a dependency-free Node script (Node's global WebSocket), not Playwright — the owner forbids local browser
  automation and Playwright's Android support needs a different setup — a flaky emulator costs CI time only.
- Ruling: the job runs for pull requests touching `apps/android/**`, `apps/web/src/lib/native/**` or the workflow, and
  by hand; not on every PR — it takes about 8 minutes and needs KVM — a change elsewhere in the web app that breaks the
  shell is found at the next shell change or by a manual run.
- Ruling: no native file storage, no Keystore token store, persistence requested once — see the design doc's
  rulings with their numbers.
- Ruling: `ACCESS_NETWORK_STATE` declared and the back handler tolerant of the injected proxy — found by the first
  runs; without them the page was blank and the online event never fired.

## Tasks

1. [x] `apps/android/e2e/`: `build-server.sh`, `lib.mjs` (adb, CDP client, step recorder), `drive.mjs`.
2. [x] `.github/workflows/android-emulator.yml` (KVM udev rule, `reactivecircus/android-emulator-runner` pinned to a
   commit, API 34 google_apis x86_64, headless, no AVD cache; summary and logs as artifacts).
3. [x] Measure and record; two defects fixed (`lib/native/back.ts`, manifest permission); the shell counts as installed
   for the persistence request.
4. [ ] Owner: the airplane-mode check on a real phone and a phone restart (done-when items of #35).
5. [ ] Follow-up: the review outbox to IndexedDB or a `pagehide` flush.

## Verification log

Runs on the PR: the first two failed at the web app step (a blank page: the back handler threw), the third found the
lost reviews and the missing permission, the fourth lost the app process to a Play Services restart on the emulator
image (the driver now waits it out), the fifth was green (8 min). Web `npm run check` and the unit tests ran in the
`build` workflow.
