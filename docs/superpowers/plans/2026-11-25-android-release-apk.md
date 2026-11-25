# Signed release APK on a tag — plan (issue #148, milestone v0.7.0)

Goal: pushing a `v*` semver tag produces a signed APK and its SHA-256 file on the GitHub release, for sideloading.
Not in scope: the release checklist (#147), release notes, an AAB, Play/F-Droid. Record:
`docs/architecture/0010-android-shell-and-native-bridge.md` ("Release build and signing").

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
  from the tag — it catches a wrong -P property before publishing (a release build without signing input is
  UNSIGNED, not debug-signed; apksigner then fails, see Review fixes) — cost if wrong is a
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
3. **Create the environment `android-release`** (Settings, Environments): deployment branches and tags limited to
   `v*` tags (a selected-tags rule `v*`), optionally required reviewers. Then **add the four secrets to that
   environment** (Settings, Environments, android-release, Environment secrets; or `gh secret set --env
   android-release`), and delete any repository-level copies afterwards, because a repository-scoped secret is
   readable by a workflow on any collaborator's branch. Repository-level secrets keep working until then, so
   nothing breaks if this is done later. The shell reads the value from stdin or a prompt so it stays out of history:

   | Secret | Content |
   | --- | --- |
   | `ANDROID_KEYSTORE_BASE64` | `base64 -w0 qinqin-release.jks` |
   | `ANDROID_KEYSTORE_PASSWORD` | the keystore password |
   | `ANDROID_KEY_ALIAS` | `qinqin` (the `-alias` above) |
   | `ANDROID_KEY_PASSWORD` | the key password (same as the keystore password for PKCS12) |

   ```sh
   base64 -w0 qinqin-release.jks | gh secret set ANDROID_KEYSTORE_BASE64 --env android-release --repo Elaktrato/qinqin
   gh secret set ANDROID_KEYSTORE_PASSWORD --env android-release --repo Elaktrato/qinqin
   gh secret set ANDROID_KEY_ALIAS --env android-release --repo Elaktrato/qinqin
   gh secret set ANDROID_KEY_PASSWORD --env android-release --repo Elaktrato/qinqin
   ```

4. **Pin the signing fingerprint**: `keytool -list -v -keystore qinqin-release.jks -alias qinqin` (the SHA-256
   line). Set the repository **variable** `ANDROID_CERT_SHA256` to it (Settings, Secrets and variables, Actions,
   Variables; public, not a secret; case and colons do not matter). A release signed with any other certificate
   then fails. Unset (first release), the job prints the fingerprint, writes it to the job summary and warns: put
   it in the release notes of that release and set the variable before the next one.
5. Before the first tag, run the `android-apk` workflow by hand (Actions, android-apk, Run workflow) to see the
   pipeline pass without secrets.

## Review fixes (stage 3)

The independent review of #148 and #147 found these; all are fixed in `fix/stage3-release-pipeline`.

- Ruling: the verify step runs under `set -euo pipefail`, writes apksigner's output to a file (no pipe) and asserts
  positively (`Verified using v2 scheme (APK Signature Scheme v2): true` and a signer certificate SHA-256 line) —
  `apksigner verify | tee` could not fail, and the "Android Debug" grep alone was the only signature check. Correction
  of the earlier wording: there is no "debug fallback": `build.gradle` applies the release signing config only when
  all four inputs are set, so a release build without them is an unsigned APK and apksigner fails on it; the debug
  certificate appears only in the dry run (`assembleDebug`) — a signing check that is too strict would block a
  release until relaxed.
- Ruling: an optional repository variable `ANDROID_CERT_SHA256` pins the certificate; set, a different signer fails
  the job (case and colons ignored), unset, the fingerprint is printed, written to the job summary and warned about —
  nothing otherwise forced the same key on every release, and a hard requirement would make the first release
  impossible (the owner learns the fingerprint from it, or from `keytool` beforehand) — a stale variable after a
  deliberate key change blocks the release until updated (which is the point: a key change breaks updates on every
  installed phone).
- Ruling: `npm ci`, `npm test` and `npm run sync` run in a step with no secret; the keystore is decoded immediately
  before the Gradle step, which alone has the signing environment (the build steps are a composite action,
  `.github/actions/android-apk`, shared by the dry run and the release job) — dependency install scripts would
  otherwise run beside the key — Gradle plugins and the app's Gradle build still run with the key (unavoidable for
  signing). The npm cache is dropped on the release path and kept for the dry run — a release builds a few times a
  year, so a cold `npm ci` costs about a minute, and a cache entry nobody reviewed should not feed the signing build —
  slower release runs.
- Ruling: the signing job is its own job `release` in `android-apk.yml` with `environment: android-release`, the
  dry run another job (`dryrun`) without one — an environment cannot be conditional on an input without relying on
  an undocumented empty-name case, and a dry run from a branch must not need an environment approval or a tag rule —
  two short jobs instead of one. The owner restricts the environment to `v*` tags and moves the secrets there, so a
  collaborator's branch workflow cannot read them; build.yml passes the four secrets explicitly instead of
  `secrets: inherit`. Repository-level secrets keep working until moved. Not verified without a real run: whether a
  secret passed explicitly by the caller (empty once the repository copy is deleted) shadows the same-named
  environment secret of the called job; if it does, the first tag build fails at "signing secrets missing" naming
  them, nothing unsigned is published, and the fix is to drop the `secrets:` block of the `android` job and the
  `workflow_call` secrets declaration. Try it with an `-rc.N` tag.
- Ruling: the release is created as a draft, the APK and `.sha256` are uploaded, then `gh release edit
  --draft=false` publishes it (a hyphenated tag stays a pre-release) — a public release without its APK existed
  between create and upload — a failed upload leaves a draft only; re-running the job resumes it (`--clobber`). A
  draft exists during the run only, so the checklist recommends an `-rc.N` tag to smoke-test the signed APK first.
- Ruling: a cheap `tag` job runs `version-code.mjs` on a release tag and `image` and `android` need it — the image
  was pushed even for a tag the Android build refuses — the image is still published when only the APK step fails
  (secret missing); that is accepted because the release is withheld and the failed jobs can be re-run.
- Ruling: a pre-release is accepted in exactly one spelling, `alpha.N`, `beta.N` or `rc.N`, N without leading zeros —
  `rc`, `rc1`, `rc.1` and `rc.01` all mapped to one versionCode, so two tags could produce APKs Android treats as the
  same version — `v0.7.0-rc1` style tags now fail (the image job's own check is looser but `tag` runs first).
- Ruling: `*.jks` and `*.keystore` are ignored in `apps/android/android/.gitignore` — the template had them
  commented out — a keystore needed for a test must be named differently or force-added, deliberately.
- Ruling: the docs say the shell compares only the bridge (never the contract), `latest` is built from `main`
  (not by a release tag), and the checklist asks for the fingerprint in the release notes and the DRAFT banner
  removed — they contradicted `verify.ts` and `build.yml` — older release notes (v0.2.0 to v0.5.0) still carry the
  same "also `latest`" wording; they are published history and left as is.
