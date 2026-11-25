# v0.7.0 release path handoff — signed APK and sideload checklist (2026-11-25)

> **Update (2026-11-25, owner decision):** the APK is no longer built or signed in CI. The table and the owner steps
> below describe the new local flow; the original CI design is in the plan's history.

Stage 3 of the v0.7.0 run: #148 and #147 (the store listing, #149, is "After v1.0"). One independent review
(strongest model) covered both, followed by one fix wave. Nothing went to `main`; **no tag, no release was created,
and no credentials exist in the repository**. The local release script has been run only with a throw-away keystore.

## 1. What shipped

| Item | What | `develop` merge |
|---|---|---|
| #148 | `apps/android/scripts/release-local.sh <tag>` builds a signed release APK `qinqin-<version>.apk` and `qinqin-<version>.apk.sha256` on the owner's machine (uploaded to the draft GitHub release by hand; CI does not build or sign it). versionName = tag; versionCode = major·1,000,000 + minor·10,000 + patch·100 + slot (release 99, alpha 1–29, beta 30–59, rc 60–89), so `v0.7.0` = 70099; signing from a local keystore (no GitHub secrets); no AAB (extension point documented in ADR 0010) | `e8b533ab` |
| #147 | Sideload checklist in `docs/release-checklist.md` (version, changelog, shell/server compatibility, clean-device smoke test, update, rollback, artifact verification) and the draft `docs/releases/v0.7.0.md` | `75b65a50` |
| Review fixes | Verify step really fails on a bad signature; optional pinned certificate fingerprint; signing input kept away from npm scripts; draft-then-publish release; one spelling per pre-release label; docs corrected | `5c17bc26` |
| Change of direction | The CI build and signing were removed (`android-apk.yml`, the composite action, the `android` and `tag` jobs); the `release` job creates a draft; `release-local.sh` + `release-checks.mjs` + optional `release-fingerprint.txt` added | PR into `develop` |

## 2. Owner-only steps (nothing here was done for you)

1. **Choose the package id and app name** (placeholder `io.github.elaktrato.qinqin` / `qinqin` in
   `apps/android/identity.json`). The id is permanent once an APK is installed or published.
2. **Create the signing keystore** (`keytool -genkeypair -v -keystore qinqin-release.jks -alias qinqin -keyalg RSA
   -keysize 4096 -validity 10000`; exact commands in `docs/superpowers/plans/2026-11-25-android-release-apk.md`) and keep an offline backup
   plus the passwords. A lost keystore means installed phones can never update.
3. **Build locally**: set `JAVA_HOME`, `ANDROID_HOME`, `QINQIN_KEYSTORE_FILE` and `QINQIN_KEY_ALIAS`, check out the
   tag and run `apps/android/scripts/release-local.sh v0.7.0-rc.1` (it asks for the passwords). Nothing is set in
   GitHub: delete the environment `android-release`, the four secrets and the variable `ANDROID_CERT_SHA256` if you
   had created them.
4. **Tag `v0.7.0-rc.1` first**: the image is pushed and a draft pre-release is created; smoke-test the APK from the
   script, upload it with the printed `gh release upload` command and publish (see `docs/release-checklist.md`).
5. After the first signed build, commit the printed signer fingerprint to `apps/android/release-fingerprint.txt`
   (so later builds fail if the certificate ever changes) and paste it into the release notes.
6. Remove the DRAFT banner and the fingerprint TODO from `docs/releases/v0.7.0.md` before the final tag.

## 3. Rulings (full list with costs in the plan's "Review fixes (stage 3)" section)

- versionCode scheme with pre-release slots; pre-release labels other than `alpha.N`/`beta.N`/`rc.N` fail the build.
- Local signing instead of CI: the keystore never leaves the owner's machine and GitHub holds no secrets. Cost: the
  release depends on one person's machine and there is no reproducible CI artifact.
- The release is created as a draft by the `release` job and published by the owner after uploading the APK.
- `package.json`'s version stays a local default; the tag is the single source at build time.
- No AAB until the store work (after v1.0).

## 4. Not verified

The local script ran end to end only with a throw-away keystore, and the release upload was never run; the checklist's
clean-device steps, update-over-install and rollback were never run on a phone. The release notes were not checked
against a device. Older release notes (v0.2.0–v0.5.0) still say "also `latest`"; left as published history.

## 5. What's next

The owner's steps above, then tagging `v0.7.0-rc.1`, the real-phone checks in the stage-1 and stage-2 handoffs,
and the final `v0.7.0` tag. Merging `develop` to `main`, tagging and releasing stay with the owner.
