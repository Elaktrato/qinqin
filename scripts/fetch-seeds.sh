#!/usr/bin/env bash
# Download the large upstream datasets into plugins/data/ as ready-to-seed
# packs (manifest.json + the data file the importer reads). The downloads
# are gitignored; only the small hand-written packs are committed.
#
#   scripts/fetch-seeds.sh [dest]      # dest defaults to plugins/data
#
# Seed order matters — dictionaries and character data before level packs —
# but `qinqin seed` sorts that out itself.
set -euo pipefail

dest="${1:-$(cd "$(dirname "$0")/.." && pwd)/plugins/data}"
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT

fetch() { # url outfile
  echo "downloading $1"
  curl -fsSL --retry 3 -o "$2" "$1"
}

manifest() { # dir id name type language license attribution format
  mkdir -p "$1"
  cat >"$1/manifest.json" <<EOF
{
  "id": "$2",
  "name": "$3",
  "version": "$(date -u +%Y-%m-%d)",
  "type": "$4",
  "language": "$5",
  "license": "$6",
  "attribution": "$7",
  "format": "$8"
}
EOF
}

# CC-CEDICT (Mandarin–English words), CC BY-SA 4.0.
fetch "https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz" "$tmp/cedict.gz"
manifest "$dest/cedict" cedict "CC-CEDICT" dictionary zh "CC BY-SA 4.0" \
  "CC-CEDICT, MDBG (https://cc-cedict.org)" cedict
gunzip -c "$tmp/cedict.gz" >"$dest/cedict/dictionary.txt"

# Unihan (character variants, radicals, definitions), Unicode License.
# The importer reads one file: concatenate the parts that carry the
# keys it uses (kRSUnicode, kSimplifiedVariant/kTraditionalVariant,
# kDefinition).
fetch "https://www.unicode.org/Public/UCD/latest/ucd/Unihan.zip" "$tmp/unihan.zip"
unzip -q -o "$tmp/unihan.zip" -d "$tmp/unihan"
manifest "$dest/unihan" unihan "Unihan database" dictionary zh "Unicode License" \
  "Unicode Consortium, Unihan database" unihan
cat "$tmp/unihan/Unihan_IRGSources.txt" "$tmp/unihan/Unihan_Variants.txt" \
  "$tmp/unihan/Unihan_Readings.txt" >"$dest/unihan/dictionary.txt"

# JMdict (Japanese–English words), CC BY-SA 4.0 (EDRDG).
fetch "http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz" "$tmp/jmdict.gz"
manifest "$dest/jmdict" jmdict "JMdict" dictionary ja "CC BY-SA 4.0" \
  "Electronic Dictionary Research and Development Group (EDRDG)" jmdict
gunzip -c "$tmp/jmdict.gz" >"$dest/jmdict/jmdict.xml"

# KANJIDIC2 (kanji readings, meanings, strokes, radicals), CC BY-SA 4.0 (EDRDG).
fetch "http://www.edrdg.org/kanjidic/kanjidic2.xml.gz" "$tmp/kanjidic2.gz"
manifest "$dest/kanjidic2" kanjidic2 "KANJIDIC2" dictionary ja "CC BY-SA 4.0" \
  "Electronic Dictionary Research and Development Group (EDRDG)" kanjidic2
gunzip -c "$tmp/kanjidic2.gz" >"$dest/kanjidic2/kanjidic2.xml"

echo "done — now run: qinqin seed --data <dir> --packs $dest"
