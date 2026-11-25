# v0.7.0 release path handoff — signed APK and sideload checklist (2026-11-25)

Stage 3 of the v0.7.0 run: #148 and #147 (the store listing, #149, is "After v1.0"). One independent review
(strongest model) covered both, followed by one fix wave. Nothing went to `main`; **no tag, no release was created,
and no credentials exist in the repository**. The pipeline has never run on a real runner with secrets.

## 1. What shipped

| Item | What | `develop` merge |
|---|---|---|
| #148 | A `v*` semver tag builds a signed release APK `qinqin-<version>.apk` and `qinqin-<version>.apk.sha256`, attached to the GitHub release. versionName = tag; versionCode = major·1,000,000 + minor·10,000 + patch·100 + slot (release 99, alpha 1–29, beta 30–59, rc 60–89), so `v0.7.0` = 70099; signing only from secrets, only on a tag in `Elaktrato/qinqin`; a manual dry run builds a debug-signed APK as an artifact only; no AAB (extension point documented in ADR 0010) | `e8b533ab` |
| #147 | Sideload checklist in `docs/release-checklist.md` (version, changelog, shell/server compatibility, clean-device smoke test, update, rollback, artifact verification) and the draft `docs/releases/v0.7.0.md` | `75b65a50` |
| Review fixes | Verify step really fails on a bad signature; optional pinned certificate fingerprint; signing secrets kept away from npm scripts; signing job behind the `android-release` environment with explicit secrets; draft-then-publish release; tag validated before the image is pushed; one spelling per pre-release label; docs corrected | `5c17bc26` |

## 2. Owner-only steps (nothing here was done for you)

1. **Choose the package id and app name** (placeholder `io.github.elaktrato.qinqin` / `qinqin` in
   `apps/android/identity.json`). The id is permanent once an APK is installed or published.
2. **Create the signing keystore** (`keytool -genkeypair -v -keystore qinqin-release.jks -alias qinqin -keyalg RSA
   -keysize 4096 -validity 10000`; exact commands in `docs/superpowers/plans/2026-11-25-android-release-apk.md`) and keep an offline backup
   plus the passwords. A lost keystore means installed phones can never update.
3. **Create the GitHub environment `android-release`**, restrict deployment to `v*` tags (optionally add a required
   reviewer) and add the four secrets there: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`,
   `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Repository-level secrets with the same names also work until then.
4. **Run the `android-apk` workflow by hand once** (dry run, no secrets) to test the pipeline.
5. **Tag `v0.7.0-rc.1` first.** Open risk: I could not verify whether secrets passed explicitly by the caller
   shadow environment secrets in the called workflow. If they do, the build fails at "signing secrets missing",
   naming them, and nothing unsigned is published; the fix is recorded in the plan.
6. After the first signed build, set the repository **variable** `ANDROID_CERT_SHA256` to the printed signer
   fingerprint (so later releases fail if the certificate ever changes) and paste the fingerprint into the release notes.
7. Remove the DRAFT banner and the fingerprint TODO from `docs/releases/v0.7.0.md` before the final tag.

## 3. Rulings (full list with costs in the plan's "Review fixes (stage 3)" section)

- versionCode scheme with pre-release slots; pre-release labels other than `alpha.N`/`beta.N`/`rc.N` fail the build.
- The APK is a reusable workflow called from `build.yml`; the release is created as a draft and published only
  after the APK is attached. Cost: a missing secret blocks the GitHub release (the image may already be pushed;
  only an invalid tag is blocked before the image).
- Signing runs only for a tag in `Elaktrato/qinqin`; a repository rename must update the guard.
- `package.json`'s version stays a local default; the tag is the single source at build time.
- No AAB until the store work (after v1.0).

## 4. Not verified

The signing path and the release upload have never run on GitHub (no secrets exist); the checklist's
clean-device steps, update-over-install and rollback were never run on a phone. The release notes were not checked
against a device. Older release notes (v0.2.0–v0.5.0) still say "also `latest`"; left as published history.

## 5. What's next

The owner's steps above, then tagging `v0.7.0-rc.1`, the real-phone checks in the stage-1 and stage-2 handoffs,
and the final `v0.7.0` tag. Merging `develop` to `main`, tagging and releasing stay with the owner.
