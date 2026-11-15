#!/bin/sh
# Fetch the Kanji alive example-word audio (CC BY 4.0) and build the
# kanjialive-audio pack: 10,156 Opus clips of common words for 1,235 kanji,
# spoken by native Japanese speakers, with an index of word, reading and file.
#
#   scripts/fetch-audio-kanjialive.sh [dest]   # dest defaults to plugins/data-audio
#
# Nothing it downloads or writes is committed: dest is gitignored
# (/plugins/data-audio/) and the Docker image runs this script in a build
# stage. Licence evidence (checked 2026-11-15): the repository's LICENSE.md
# at the pinned commit says "licensed under a Creative Commons Attribution
# 4.0 International License"; the README names only two fonts as exceptions.
#
# Every input is pinned: the repository files by commit and SHA-256, the zip
# by size and SHA-256. A mismatch stops the build; to adopt a new snapshot a
# maintainer re-reads the licence, then sets KANJIALIVE_ZIP_SHA256 (and the
# commit pins below) after checking the file by eye. The CC BY 4.0 legal code
# is not hash-pinned (Creative Commons may fix typos); its title is checked and
# its SHA-256 is printed. The word-to-file mapping (the n-th example word of a
# kanji is <kname>_06_<a..l>.opus, as examples-audio/README.md of the data
# repository documents; that file is pinned too) is checked by the build: every example must
# find its file, and the count must equal EXPECTED_CLIPS.
#
# Every pin can be overridden from the environment (the Dockerfile exposes them as
# build args): KANJIALIVE_COMMIT, KANJIALIVE_CSV_SHA256, KANJIALIVE_LICENSE_SHA256,
# KANJIALIVE_EXAMPLES_README_SHA256, KANJIALIVE_ZIP_SHA256, KANJIALIVE_ZIP_BYTES, KANJIALIVE_EXPECTED_CLIPS,
# KANJIALIVE_SNAPSHOT and KANJIALIVE_ZIP_URL (a mirror; the checksum still has to
# match). An empty value means the default.
#
# Needs curl, sha256sum, unzip and node (22 or newer: only basic APIs are used).
# About 69 MB downloaded.
set -eu

COMMIT=${KANJIALIVE_COMMIT:-e1e24d39fc43e839948a8c7e99743b0994dedad5}
RAW=https://raw.githubusercontent.com/kanjialive/kanji-data-media/$COMMIT
ZIP_URL=${KANJIALIVE_ZIP_URL:-https://media.kanjialive.com/examples_audio/audio-opus.zip}
LEGAL_URL=https://creativecommons.org/licenses/by/4.0/legalcode.txt
CSV_SHA256=${KANJIALIVE_CSV_SHA256:-7b463876a0837bfb1f754a4e1bec43617b62f92b9839bbdf060d6ad0d8dbaf65}
README_SHA256=${KANJIALIVE_EXAMPLES_README_SHA256:-eaa6768284e2ba74cde8691d81712753e22aa305ed4b7f5bcb320a0d83bea1d1}
LICENSE_SHA256=${KANJIALIVE_LICENSE_SHA256:-80602b5a0e7b85dff1da4a91f1ab7d19012436335bfcde97bac6dc066ded33bd}
ZIP_SHA256=${KANJIALIVE_ZIP_SHA256:-b3ee4c740d73fa3e97bef85fe3346b30687699e97d36868d5939b6f4ee6338ef}
ZIP_BYTES=${KANJIALIVE_ZIP_BYTES:-68687036}
EXPECTED_CLIPS=${KANJIALIVE_EXPECTED_CLIPS:-10156}
SNAPSHOT=${KANJIALIVE_SNAPSHOT:-2026-09-04}

here=$(cd "$(dirname "$0")" && pwd)
repo=$(dirname "$here")
dest=${1:-$repo/plugins/data-audio}
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

die() { echo "fetch-audio-kanjialive: $*" >&2; exit 1; }
need() { command -v "$1" >/dev/null 2>&1 || die "$1 is required"; }
for tool in curl sha256sum unzip node; do need "$tool"; done

fetch() { curl -fsSL --retry 3 -o "$2" "$1" || die "download failed: $1"; }
check() { # file expected-sha256 label
  got=$(sha256sum "$1" | cut -d' ' -f1)
  [ "$got" = "$2" ] || die "$3: SHA-256 is $got, pinned $2. Refusing; review the change, then update the pin."
}

echo "fetching ka_data.csv and LICENSE.md at $COMMIT"
fetch "$RAW/language-data/ka_data.csv" "$work/ka_data.csv"
fetch "$RAW/LICENSE.md" "$work/LICENSE.md"
fetch "$RAW/examples-audio/README.md" "$work/examples-audio-README.md"
check "$work/ka_data.csv" "$CSV_SHA256" ka_data.csv
check "$work/examples-audio-README.md" "$README_SHA256" examples-audio/README.md
# The publisher's own statement of the word-to-file mapping (suffix a..l in the order
# of the examples column): pinned as evidence, and checked again by the clip count.
grep -q "suffix 'a' to 'l'" "$work/examples-audio-README.md" || die "examples-audio/README.md no longer documents the a..l suffix mapping"
check "$work/LICENSE.md" "$LICENSE_SHA256" LICENSE.md
grep -q 'Creative Commons Attribution 4.0 International License' "$work/LICENSE.md" || die "LICENSE.md no longer names CC BY 4.0"

echo "fetching the CC BY 4.0 legal code"
fetch "$LEGAL_URL" "$work/legalcode.txt"
head -n 1 "$work/legalcode.txt" | grep -q 'Attribution 4.0 International' || die "legalcode.txt is not the CC BY 4.0 text"
legal_sha=$(sha256sum "$work/legalcode.txt" | cut -d' ' -f1)

echo "fetching audio-opus.zip (about 69 MB)"
fetch "$ZIP_URL" "$work/audio-opus.zip"
size=$(wc -c < "$work/audio-opus.zip")
[ "$size" -eq "$ZIP_BYTES" ] || die "audio-opus.zip is $size bytes, pinned $ZIP_BYTES (SHA-256 $(sha256sum "$work/audio-opus.zip" | cut -d' ' -f1))"
check "$work/audio-opus.zip" "$ZIP_SHA256" audio-opus.zip
mkdir "$work/un"
unzip -q "$work/audio-opus.zip" -d "$work/un"

note="Snapshot of $SNAPSHOT; kanji-data-media commit $COMMIT, audio-opus.zip SHA-256 $ZIP_SHA256, CC BY 4.0 legal code SHA-256 $legal_sha"
out=$(node "$here/prepare-audio-kanjialive.mjs" "$work/ka_data.csv" "$work/un" "$work/pack" \
  --license-file "$work/legalcode.txt" --version "$SNAPSHOT" --note "$note")
echo "$out"
case "$out" in
  "kanjialive-audio: $EXPECTED_CLIPS clips, 0 skipped"*) ;;
  *) die "expected $EXPECTED_CLIPS clips and none skipped: the word-to-file mapping no longer holds" ;;
esac

mkdir -p "$dest"
rm -rf "$dest/kanjialive-audio"
mv "$work/pack" "$dest/kanjialive-audio"
echo "wrote $dest/kanjialive-audio"
