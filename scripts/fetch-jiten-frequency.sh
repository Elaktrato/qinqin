#!/usr/bin/env bash
# Download Jiten's global Japanese frequency list (CC BY-SA 4.0, as stated
# by the publisher on https://jiten.moe/frequency-dictionaries and in art.
# 6.1 of https://jiten.moe/terms) and write it as the freq-csv pack
# jiten-frequency: freq.csv.gz (term,reading,rank), manifest, licence text
# and attribution. One download of the published file; no API is proxied.
#
# The source is the Yomitan-format zip, not the CSV download: besides the
# rank of each word's kanji spelling (為る/する 18323), the zip gives the
# rank of its kana spelling attributed to that word (為る/する 10, where
# the CSV only has an unattributed する row). Every frequency row of the
# zip becomes one CSV row with its rank unchanged, except exact duplicates
# (same term, reading and rank), kept once; a row without a reading keeps
# an empty reading (it applies to any reading).
#
# Refreshing the snapshot is a one-off manual maintainer action, never run
# in CI or by the app. Before it, re-read
# https://jiten.moe/frequency-dictionaries and https://jiten.moe/terms and
# confirm the frequency lists are still CC BY-SA 4.0 with no term against
# redistributing a snapshot; then pass the date of that check and the terms
# version, which go into ATTRIBUTION.md:
#
#   JITEN_LICENCE_CHECKED=2026-11-12 JITEN_TERMS_VERSION=2026-08-08 \
#     scripts/fetch-jiten-frequency.sh [dest]   # dest defaults to plugins/data
#
# The pack is built in a staging directory and replaces
# <dest>/jiten-frequency only once everything succeeded.
#
# Needs curl and python3 (only for this refresh; building, running and
# testing the app do not).
set -euo pipefail

if [[ ! "${JITEN_LICENCE_CHECKED:-}" =~ ^[0-9]{4}-[0-9]{2}-[0-9]{2}$ || -z "${JITEN_TERMS_VERSION:-}" ]]; then
  cat >&2 <<'EOF'
fetch-jiten-frequency: set JITEN_LICENCE_CHECKED=<YYYY-MM-DD> and JITEN_TERMS_VERSION=<version>.
Before refreshing the Jiten snapshot, re-read https://jiten.moe/frequency-dictionaries
and https://jiten.moe/terms: the frequency lists must still be licensed CC BY-SA 4.0
and nothing may forbid redistributing a snapshot with attribution. Pass the date of
that check and the terms version shown at the top of the terms page.
EOF
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-$root/plugins/data}"
dir="$dest/jiten-frequency"
mkdir -p "$dest"
tmp="$(mktemp -d)"
# Staged next to the pack so the final moves are renames on one filesystem.
stage="$(mktemp -d "$dest/.jiten-frequency.XXXXXX")"
chmod 755 "$stage"
trap 'rm -rf "$tmp" "$stage"' EXIT

. "$root/scripts/pack-lib.sh"

fetch "https://api.jiten.moe/api/frequency-list/download?downloadType=yomitan" "$tmp/jiten_freq_global.zip"
fetch "$cc_by_sa_4_url" "$tmp/CC-BY-SA-4.0.txt"

manifest "$stage" jiten-frequency "Jiten frequency list" frequency ja "CC BY-SA 4.0" \
  "Jiten (https://jiten.moe), global frequency list" freq-csv
cp "$tmp/CC-BY-SA-4.0.txt" "$stage/LICENSE"

# The zip is read in place (never unpacked) and only parsed as JSON.
revision="$(python3 -I - "$tmp/jiten_freq_global.zip" "$stage/freq.csv.gz" <<'PY'
import csv, gzip, io, json, sys, zipfile

src, out = sys.argv[1], sys.argv[2]
with zipfile.ZipFile(src) as z:
    index = json.loads(z.read("index.json"))
    if index.get("frequencyMode", "rank-based") != "rank-based":
        sys.exit("jiten: frequencyMode is not rank-based")
    banks = sorted(n for n in z.namelist() if n.startswith("term_meta_bank_") and n.endswith(".json"))
    if not banks:
        sys.exit("jiten: no term_meta_bank files in the zip")
    # mtime=0: the same download gives byte-identical output.
    with open(out, "wb") as raw, gzip.GzipFile(filename="", mode="wb", fileobj=raw, mtime=0) as gz:
        text = io.TextIOWrapper(gz, encoding="utf-8", newline="")
        w = csv.writer(text, lineterminator="\n")
        w.writerow(["term", "reading", "rank"])
        rows, dups, seen = 0, 0, set()
        for name in banks:
            for term, kind, data in json.loads(z.read(name)):
                if kind != "freq":
                    continue
                reading = ""
                if isinstance(data, dict) and "frequency" in data:
                    reading, data = data.get("reading", ""), data["frequency"]
                value = data["value"] if isinstance(data, dict) else data
                rank = int(value)
                if rank != value or rank < 1 or not term:
                    sys.exit(f"jiten: bad row {term!r} {data!r} in {name}")
                if (term, reading, rank) in seen:
                    dups += 1
                    continue
                seen.add((term, reading, rank))
                w.writerow([term, reading, rank])
                rows += 1
        text.flush()
        text.detach()
    print(index.get("revision", ""))
    print(f"jiten: {rows} rows ({dups} exact duplicates dropped)", file=sys.stderr)
PY
)"

cat >"$stage/ATTRIBUTION.md" <<EOF
# Jiten frequency list

Japanese word frequency ranks from Jiten (https://jiten.moe), © Jitensoft,
built from the Japanese media analysed on Jiten. Global list, revision
"$revision", downloaded $(date -u +%Y-%m-%d) from
https://api.jiten.moe/api/frequency-list/download?downloadType=yomitan.

Licence as stated by the publisher (checked $JITEN_LICENCE_CHECKED):

- https://jiten.moe/frequency-dictionaries: "All frequency lists are
  licensed under CC BY-SA 4.0."
- https://jiten.moe/terms (version $JITEN_TERMS_VERSION), art. 6.1: "Derived Data
  published by Jiten, including study decks, vocabulary lists and
  frequency lists, is licensed under CC BY-SA 4.0. Within that licence,
  commercial use is permitted, subject to attribution and share-alike."

Unmodified rank data converted to CSV; no API is proxied. freq.csv.gz holds
every frequency row of Jiten's Yomitan-format file as term,reading,rank,
with the ranks as published (ranks unmodified); exact duplicate rows are
kept once and Jiten's display markers are dropped. This converted file is
shared under the same licence, CC BY-SA 4.0. See LICENSE in this directory
for the full license text; scripts/fetch-jiten-frequency.sh reproduces the
conversion.
EOF

# Everything succeeded: swap the staged pack in.
rm -rf "$dir.old"
if [ -e "$dir" ]; then
  mv "$dir" "$dir.old"
fi
if ! mv "$stage" "$dir"; then
  [ -e "$dir.old" ] && mv "$dir.old" "$dir"
  exit 1
fi
rm -rf "$dir.old"
echo "jiten-frequency written to $dir"
