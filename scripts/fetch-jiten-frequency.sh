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
# zip becomes one CSV row with its rank unchanged; a row without a reading
# keeps an empty reading (it applies to any reading).
#
# Needs curl and python3.
#
#   scripts/fetch-jiten-frequency.sh [dest]   # dest defaults to plugins/data
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-$root/plugins/data}"
dir="$dest/jiten-frequency"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

. "$root/scripts/pack-lib.sh"

fetch "https://api.jiten.moe/api/frequency-list/download?downloadType=yomitan" "$tmp/jiten_freq_global.zip"
fetch "$cc_by_sa_4_url" "$tmp/CC-BY-SA-4.0.txt"

manifest "$dir" jiten-frequency "Jiten frequency list" frequency ja "CC BY-SA 4.0" \
  "Jiten (https://jiten.moe), global frequency list" freq-csv
cp "$tmp/CC-BY-SA-4.0.txt" "$dir/LICENSE"

# The zip is read in place (never unpacked) and only parsed as JSON.
revision="$(python3 -I - "$tmp/jiten_freq_global.zip" "$dir/freq.csv.gz" <<'PY'
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
        rows = 0
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
                w.writerow([term, reading, rank])
                rows += 1
        text.flush()
        text.detach()
    print(index.get("revision", ""))
    print(f"jiten: {rows} rows", file=sys.stderr)
PY
)"

cat >"$dir/ATTRIBUTION.md" <<EOF
# Jiten frequency list

Japanese word frequency ranks from Jiten (https://jiten.moe), © Jitensoft,
built from the Japanese media analysed on Jiten. Global list, revision
"$revision", downloaded $(date -u +%Y-%m-%d) from
https://api.jiten.moe/api/frequency-list/download?downloadType=yomitan.

Licence as stated by the publisher (checked 2026-11-12):

- https://jiten.moe/frequency-dictionaries: "All frequency lists are
  licensed under CC BY-SA 4.0."
- https://jiten.moe/terms (version 2026-08-08), art. 6.1: "Derived Data
  published by Jiten, including study decks, vocabulary lists and
  frequency lists, is licensed under CC BY-SA 4.0. Within that licence,
  commercial use is permitted, subject to attribution and share-alike."

Unmodified rank data converted to CSV; no API is proxied. freq.csv.gz holds
every frequency row of Jiten's Yomitan-format file as term,reading,rank,
with the ranks as published; Jiten's display markers are dropped. This
converted file is shared under the same licence, CC BY-SA 4.0. See LICENSE
in this directory for the full license text; scripts/fetch-jiten-frequency.sh
reproduces the conversion.
EOF

echo "jiten-frequency written to $dir"
