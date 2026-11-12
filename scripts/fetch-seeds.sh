#!/usr/bin/env bash
# Download the upstream data into plugins/data/ as ready-to-seed starter
# packs, each with a manifest, the license text, and attribution. The
# dictionaries are the compressed files exactly as upstream ships them (the
# importers read .gz/.zip directly, so nothing is decompressed here); the
# Jiten frequency list is converted to freq-csv by
# scripts/fetch-jiten-frequency.sh, which needs python3. The results are
# committed to the repo, so a fresh clone/deploy seeds offline. This script
# exists to reproduce or refresh the bundle, by hand.
#
# The Jiten step requires JITEN_LICENCE_CHECKED and JITEN_TERMS_VERSION
# (see scripts/fetch-jiten-frequency.sh: re-check Jiten's licence first).
#
#   JITEN_LICENCE_CHECKED=<YYYY-MM-DD> JITEN_TERMS_VERSION=<version> \
#     scripts/fetch-seeds.sh [dest]      # dest defaults to plugins/data
set -euo pipefail

# Fail before downloading anything; the Jiten script explains the values.
if [ -z "${JITEN_LICENCE_CHECKED:-}" ] || [ -z "${JITEN_TERMS_VERSION:-}" ]; then
  echo "fetch-seeds: set JITEN_LICENCE_CHECKED and JITEN_TERMS_VERSION (see scripts/fetch-jiten-frequency.sh)" >&2
  exit 1
fi

root="$(cd "$(dirname "$0")/.." && pwd)"
dest="${1:-$root/plugins/data}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

# Legacy layout from the previous script: decompressed payloads
# (dictionary.txt, jmdict.xml, kanjidic2.xml) take precedence over the new
# compressed files in the importers' lookup order, so refreshing an old
# directory would silently keep importing stale data. Remove them.
rm -f "$dest"/cedict/dictionary.txt "$dest"/unihan/dictionary.txt \
      "$dest"/jmdict/jmdict.xml "$dest"/kanjidic2/kanjidic2.xml

. "$root/scripts/pack-lib.sh"

attribution() { # dir title text url
  cat >"$1/ATTRIBUTION.md" <<EOF
# $2

$3

Upstream: $4

Files are redistributed unmodified. See LICENSE in this directory for the
full license text.
EOF
}

# One copy of the CC BY-SA 4.0 text serves the three CC-licensed packs.
fetch "$cc_by_sa_4_url" "$tmp/CC-BY-SA-4.0.txt"

# CC-CEDICT (Mandarin–English words), CC BY-SA 4.0.
fetch "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz" "$tmp/cedict.gz"
manifest "$dest/cedict" cedict "CC-CEDICT" dictionary zh "CC BY-SA 4.0" \
  "CC-CEDICT, MDBG (https://cc-cedict.org)" cedict
cp "$tmp/cedict.gz" "$dest/cedict/dictionary.txt.gz"
cp "$tmp/CC-BY-SA-4.0.txt" "$dest/cedict/LICENSE"
attribution "$dest/cedict" "CC-CEDICT" \
  "Chinese–English dictionary, © MDBG and the CC-CEDICT community, licensed under CC BY-SA 4.0." \
  "https://cc-cedict.org"

# Unihan (radicals, variants, character definitions), Unicode License v3.
fetch "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip" "$tmp/Unihan.zip"
fetch "https://www.unicode.org/license.txt" "$tmp/unicode-license.txt"
manifest "$dest/unihan" unihan "Unihan database" dictionary zh "Unicode License v3" \
  "Unicode Consortium, Unihan database (https://www.unicode.org/)" unihan
cp "$tmp/Unihan.zip" "$dest/unihan/Unihan.zip"
cp "$tmp/unicode-license.txt" "$dest/unihan/LICENSE"
attribution "$dest/unihan" "Unihan database" \
  "Unicode character database: radical-stroke counts (kRSUnicode), simplified/traditional variant mappings, and definitions (kDefinition), licensed under the Unicode License v3." \
  "https://www.unicode.org/reports/tr38/"

# JMdict (Japanese–English words), CC BY-SA 4.0 (EDRDG).
fetch "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz" "$tmp/jmdict.gz"
manifest "$dest/jmdict" jmdict "JMdict" dictionary ja "CC BY-SA 4.0" \
  "Electronic Dictionary Research and Development Group (EDRDG), JMdict_e" jmdict
cp "$tmp/jmdict.gz" "$dest/jmdict/jmdict.xml.gz"
cp "$tmp/CC-BY-SA-4.0.txt" "$dest/jmdict/LICENSE"
attribution "$dest/jmdict" "JMdict" \
  "Japanese–English dictionary, © Electronic Dictionary Research and Development Group (EDRDG), licensed under CC BY-SA 4.0." \
  "https://www.edrdg.org/"

# KANJIDIC2 (kanji readings, meanings, strokes, radicals), CC BY-SA 4.0 (EDRDG).
fetch "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz" "$tmp/kanjidic2.gz"
manifest "$dest/kanjidic2" kanjidic2 "KANJIDIC2" dictionary ja "CC BY-SA 4.0" \
  "Electronic Dictionary Research and Development Group (EDRDG), KANJIDIC2" kanjidic2
cp "$tmp/kanjidic2.gz" "$dest/kanjidic2/kanjidic2.xml.gz"
cp "$tmp/CC-BY-SA-4.0.txt" "$dest/kanjidic2/LICENSE"
attribution "$dest/kanjidic2" "KANJIDIC2" \
  "Kanji dictionary, © Electronic Dictionary Research and Development Group (EDRDG), licensed under CC BY-SA 4.0." \
  "https://www.edrdg.org/wiki/index.php/KANJIDIC_Project"

# Jiten frequency list (word ranks), CC BY-SA 4.0, converted to freq-csv.
"$root/scripts/fetch-jiten-frequency.sh" "$dest"

echo "done — now run: qinqin seed --data <dir> --packs $dest"
