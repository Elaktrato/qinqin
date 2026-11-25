#!/usr/bin/env bash
# Build, sign and verify the qinqin Android release APK on the owner's machine (#148). CI never builds or signs it:
# the keystore stays here. Usage:
#
#   apps/android/scripts/release-local.sh v0.7.0
#
# Needs (nothing is installed or downloaded by this script except the npm and Gradle dependencies):
#   node (the repo uses Node 26) and npm on PATH
#   JAVA_HOME     a JDK 17 or newer (the project is built with 21): $JAVA_HOME/bin/java must exist
#   ANDROID_HOME  the Android SDK (platform 35, build-tools with apksigner and aapt2); ANDROID_SDK_ROOT also works
#   QINQIN_KEYSTORE_FILE       the release keystore (outside the repository)
#   QINQIN_KEY_ALIAS           the key alias in it
#   QINQIN_KEYSTORE_PASSWORD   asked for (no echo) when unset
#   QINQIN_KEY_PASSWORD        asked for (no echo) when unset; empty input means "same as the keystore password"
# Optional:
#   QINQIN_ALLOW_OFF_TAG=1     build although HEAD is not the tag's commit (a loud warning; the default is to stop)
#
# The passwords are never printed, logged or written to disk. They are read into shell variables that are not
# exported, and handed to Gradle alone (the npm steps run with no signing input in their environment).
# Output: dist/qinqin-<version>.apk and dist/qinqin-<version>.apk.sha256 (sha256sum format), then the command that
# uploads them to the GitHub release (not run here).
set -euo pipefail

die() { echo "error: $*" >&2; exit 1; }
warn() { echo "WARNING: $*" >&2; }

tag=${1:-}
[ $# -eq 1 ] && [ -n "$tag" ] || die "usage: $0 vMAJOR.MINOR.PATCH[-pre]   (for example v0.7.0)"

script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
android_dir=$(cd "$script_dir/.." && pwd)
repo=$(git -C "$script_dir" rev-parse --show-toplevel) || die "not inside the qinqin git repository"
dist="$repo/dist"

# Capture, then drop, every signing input: npm and its lifecycle scripts must not see them.
keystore=${QINQIN_KEYSTORE_FILE:-}
alias_name=${QINQIN_KEY_ALIAS:-}
store_pw=${QINQIN_KEYSTORE_PASSWORD:-}
key_pw=${QINQIN_KEY_PASSWORD:-}
unset QINQIN_KEYSTORE_FILE QINQIN_KEY_ALIAS QINQIN_KEYSTORE_PASSWORD QINQIN_KEY_PASSWORD

command -v node >/dev/null || die "node is not on PATH (use Node 26)"
command -v npm >/dev/null || die "npm is not on PATH"
command -v git >/dev/null || die "git is not on PATH"

# --- the tag --------------------------------------------------------------------------------------------------
# version-code.mjs is the one rule for tags (semver, alpha.N/beta.N/rc.N, versionCode scheme).
if ! version_out=$(node "$script_dir/version-code.mjs" "$tag" 2>&1); then
  die "$version_out"
fi
version_name=$(printf '%s\n' "$version_out" | sed -n 's/^versionName=//p')
version_code=$(printf '%s\n' "$version_out" | sed -n 's/^versionCode=//p')
[ -n "$version_name" ] && [ -n "$version_code" ] || die "version-code.mjs printed no version for $tag"

# --- the git state --------------------------------------------------------------------------------------------
tag_commit=$(git -C "$repo" rev-parse -q --verify "refs/tags/$tag^{commit}") \
  || die "the tag $tag does not exist locally (git fetch --tags, or tag the release commit first)"
if [ -n "$(git -C "$repo" status --porcelain)" ]; then
  die "the git working tree is not clean; commit or stash your changes (a release is built from the tag, nothing else)"
fi
if [ "$(git -C "$repo" rev-parse HEAD)" != "$tag_commit" ]; then
  if [ "${QINQIN_ALLOW_OFF_TAG:-}" = 1 ]; then
    warn "HEAD is NOT the commit of $tag. This APK will not match the tag. Continuing because QINQIN_ALLOW_OFF_TAG=1."
  else
    die "HEAD is not the commit of $tag (git checkout $tag first; QINQIN_ALLOW_OFF_TAG=1 overrides, loudly)"
  fi
fi

# --- the toolchain --------------------------------------------------------------------------------------------
[ -n "${JAVA_HOME:-}" ] || die "JAVA_HOME is not set. Point it at a JDK 17 or newer (the project uses 21), e.g. export JAVA_HOME=/path/to/jdk-21"
[ -x "$JAVA_HOME/bin/java" ] || die "JAVA_HOME=$JAVA_HOME has no bin/java"
java_major=$("$JAVA_HOME/bin/java" -version 2>&1 | sed -n '1s/.*version "\([0-9]*\).*/\1/p')
[ -n "$java_major" ] && [ "$java_major" -ge 17 ] || die "the JDK in JAVA_HOME is version '${java_major:-unknown}'; 17 or newer is needed"

sdk=${ANDROID_HOME:-${ANDROID_SDK_ROOT:-}}
[ -n "$sdk" ] || die "ANDROID_HOME is not set. Point it at the Android SDK (platform 35 and build-tools installed)"
[ -d "$sdk/build-tools" ] || die "ANDROID_HOME=$sdk has no build-tools directory"
export ANDROID_HOME=$sdk
bt_version=$(ls "$sdk/build-tools" | sort -V | tail -n 1)
bt="$sdk/build-tools/$bt_version"
[ -x "$bt/apksigner" ] || die "no apksigner in $bt"
[ -x "$bt/aapt2" ] || die "no aapt2 in $bt"

# --- the keystore ---------------------------------------------------------------------------------------------
[ -n "$keystore" ] || die "QINQIN_KEYSTORE_FILE is not set (the path of your release keystore)"
[ -f "$keystore" ] || die "keystore file not found: $keystore"
keystore=$(cd "$(dirname "$keystore")" && pwd)/$(basename "$keystore")
case "$keystore" in "$repo"/*) die "the keystore is inside the repository ($keystore); keep it outside" ;; esac
[ -n "$alias_name" ] || die "QINQIN_KEY_ALIAS is not set (the key alias in the keystore)"
if [ -z "$store_pw" ]; then
  [ -t 0 ] || die "QINQIN_KEYSTORE_PASSWORD is not set and there is no terminal to ask on"
  read -r -s -p "Keystore password: " store_pw; echo
fi
[ -n "$store_pw" ] || die "the keystore password is empty"
if [ -z "$key_pw" ]; then
  if [ -t 0 ]; then
    read -r -s -p "Key password (empty: same as the keystore password): " key_pw; echo
  fi
  [ -n "$key_pw" ] || key_pw=$store_pw
fi

echo "== qinqin $tag: versionName $version_name, versionCode $version_code"
echo "== JDK $java_major ($JAVA_HOME), SDK $sdk, build-tools $bt_version"

# --- install, test, sync (no secrets in this environment) -----------------------------------------------------
cd "$android_dir"
npm ci
npm test
# The generated capacitor.config.json and www/ must exist before Gradle.
npm run sync

# --- build and sign (the only step that gets the signing input) ------------------------------------------------
built=$android_dir/android/app/build/outputs/apk/release/app-release.apk
rm -f "$built"
(
  cd "$android_dir/android"
  QINQIN_KEYSTORE_FILE=$keystore QINQIN_KEY_ALIAS=$alias_name \
    QINQIN_KEYSTORE_PASSWORD=$store_pw QINQIN_KEY_PASSWORD=$key_pw \
    ./gradlew --no-daemon assembleRelease "-PqinqinVersionName=$version_name" "-PqinqinVersionCode=$version_code"
)
unset store_pw key_pw
[ -f "$built" ] || die "Gradle did not produce $built"

# --- verify ---------------------------------------------------------------------------------------------------
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
# No pipes: a failing apksigner or aapt2 must fail the script.
"$bt/apksigner" verify --verbose --print-certs "$built" > "$work/apksigner.txt" || { cat "$work/apksigner.txt" >&2; die "apksigner does not verify the APK"; }
cat "$work/apksigner.txt"
# Positive assertions (v2 verified, a signer digest, not the debug certificate) live in release-checks.mjs.
signer_out=$(node "$script_dir/release-checks.mjs" signer "$work/apksigner.txt") || die "signature check failed"
fingerprint=${signer_out#fingerprint=}
"$bt/aapt2" dump badging "$built" > "$work/badging.txt"
badging_out=$(node "$script_dir/release-checks.mjs" badging "$work/badging.txt" "$version_code" "$version_name") || die "version check failed"

pin_file=$android_dir/release-fingerprint.txt
pin_status=0
node "$script_dir/release-checks.mjs" pin "$fingerprint" "$pin_file" > "$work/pin.txt" || pin_status=$?
case "$pin_status" in
  0) echo "Signing certificate matches release-fingerprint.txt." ;;
  3) warn "nothing pins the signing key: apps/android/release-fingerprint.txt is missing or empty. After the first release, commit this line (public) to it:"
     echo "$fingerprint" ;;
  *) die "the signing certificate $fingerprint is NOT the pinned one in apps/android/release-fingerprint.txt (wrong keystore?). Not releasing." ;;
esac

# --- the artifacts --------------------------------------------------------------------------------------------
apk_name=qinqin-$version_name.apk
mkdir -p "$dist"
cp "$built" "$dist/$apk_name"
(cd "$dist" && sha256sum "$apk_name" > "$apk_name.sha256" && sha256sum --check "$apk_name.sha256")

echo
echo "== $badging_out"
echo "== signing certificate SHA-256: $fingerprint"
echo "== $dist/$apk_name"
echo "== $dist/$apk_name.sha256"
echo
echo "Smoke-test the APK on a phone, then upload it to the (draft) release and publish it:"
echo
echo "  gh release upload $tag dist/$apk_name dist/$apk_name.sha256 --clobber"
