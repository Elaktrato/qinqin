# Signed release APK on a tag — plan (issue #148, milestone v0.7.0)

Goal: pushing a `v*` semver tag produces a signed APK and its SHA-256 file on the GitHub release, for sideloading.
Not in scope: the release checklist (#147), release notes, an AAB, Play/F-Droid. Record: `docs/architecture/0010`
("Release build and signing").

## Tasks (test first where logic exists)

1. **Version rules**: `apps/android/scripts/version-code.test.mjs` (vitest, runs in `npm test`) then
   `version-code.mjs`: tag guard, versionName, monotonic versionCode, pre-release slots, CLI writing
   `versionName=` / `versionCode=` lines (also to `$GITHUB_OUTPUT`).
2. **Gradle**: `versionCode`/`versionName` from `-PqinqinVersionCode` / `-PqinqinVersionName` (defaults: code 1,
   `package.json` version); release `signingConfig` only when `QINQIN_KEYSTORE_FILE`, `QINQIN_KEYSTORE_PASSWORD`,
   `QINQIN_KEY_ALIAS` and `QINQIN_KEY_PASSWORD` are all set.
3. **Workflow**: reusable `.github/workflows/android-apk.yml` (tag build with `release: true`, manual dry run);
   `build.yml` job `android` calls it for `v*` tags, `release` job needs it and attaches the files.
4. **Docs**: wiki Android (install, checksum), Development, ADR 0010.
5. **Verify**: version tests, `npm run check`, `./gradlew assembleRelease` unsigned and with a throw-away keystore
   (apksigner verify, aapt2 badging), YAML parse and review (no actionlint available offline), PR CI.

## Rulings

- Ruling: versionCode = major*1000000 + minor*10000 + patch*100 + slot (release 99, alpha 1-29, beta 30-59, rc 60-89) —
  the suggested major*10000+... has no room for pre-releases, and an rc must have a lower code than its release or
  Android refuses the upgrade — a changed scheme later needs codes above every shipped one (the scheme is only
  extendable upward; v0.x codes stay far below 2100000000).
- Ruling: pre-release labels other than alpha/beta/rc (and numbers above the range) fail the Android build — a
  silent guess could give two tags the same code or break the order — a tag like `v0.7.0-nightly` needs the script
  extended first (the image job still accepts it).
- Ruling: the APK build is a reusable workflow called from `build.yml`, and the `release` job `needs` it — one
  tag guard, no race over who creates the release (the existing job writes the notes from `docs/releases/`), and no
  release without its APK — a missing secret or failing APK build blocks the GitHub release (the image is already
  pushed); fix the secret and re-run the failed jobs.
- Ruling: the dry run (workflow_dispatch) builds a debug-signed `qinqin-<version>-dryrun.apk` as an artifact and
  never reads a secret — the pipeline is testable before the owner creates the keystore — a dry-run APK must never
  be distributed (its name says dryrun, retention 14 days).
- Ruling: signing runs only for a tag in `Elaktrato/qinqin` (`if` in `build.yml` and in `android-apk.yml`, plus a
  tag-ref check) — forks and pull requests cannot reach the secrets — if the repository is renamed the guard must
  change with it, or the job is silently skipped (the release job then still runs on a fork only).
- Ruling: `package.json`'s `version` stays as a local default and is not bumped per release — the tag is the single
  source at build time — a locally built APK reports the old number.
- Ruling: only first-party `actions/*` actions (tag-pinned like the rest of the repo) and the `gh` CLI; no
  third-party action, so nothing needs a commit-SHA pin — the runner's preinstalled Android SDK is relied on (as the
  emulator workflow does) — if GitHub drops it the job fails visibly.
- Ruling: the verify step fails a release APK that carries a debug certificate and one whose badging version differs
  from the tag — it catches a broken signing fallback or a wrong -P property before publishing — cost if wrong is a
  false failure that blocks a release until fixed.
- Ruling: no AAB; extension point documented in 0010 — the owner's plan is sideloading first — a Play listing needs
  one `bundleRelease` step and asset.

## Owner-only steps (not done here)

1. **Package id and app name**: edit `apps/android/identity.json` (`appId`, `appName`). The id can never change
   after the first published release; the keystore alias is independent of it.
2. **Create the keystore** (once, offline; keep a backup and the passwords in a password manager: a lost keystore
   means no more updates for installed phones):

   ```sh
   keytool -genkeypair -v -keystore qinqin-release.jks -alias qinqin \
     -keyalg RSA -keysize 4096 -validity 10000
   ```

   keytool asks for the keystore password, the identity fields and the key password (PKCS12 keystores use one
   password for both; give the same value twice).
3. **Add the four repository secrets** (Settings, Secrets and variables, Actions, or with gh; the shell reads the
   value from stdin or a prompt so it stays out of history):

   | Secret | Content |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | `base64 -w0 qinqin-release.jks` |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `qinqin` (the `-alias` above) |
   | `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password for PKCS12) |

   ```sh
   base64 -w0 qinqin-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --repo Elaktrato/qinqin
   gh secret set ANDROID_KEYSTORE_PASSWORD --repo Elaktrato/qinqin
   gh secret set ANDROID_KEY_ALIAS --repo Elaktrato/qinqin
   gh secret set ANDROID_KEY_PASSWORD --repo Elaktrato/qinqin
   ```

4. **Publish the signing fingerprint** with the first release so people can compare it:
   `keytool -list -v -keystore qinqin-release.jks -alias qinqin` (the SHA-256 line).
5. Before the first tag, run the `android-apk` workflow by hand (Actions, android-apk, Run workflow) to see the
   pipeline pass without secrets.
