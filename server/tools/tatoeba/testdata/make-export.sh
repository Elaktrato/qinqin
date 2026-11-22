#!/usr/bin/env bash
# Rebuild the fixture archives in export/ from the hand-made export-src/
# files (invented sentences, ids and users; nothing is copied from
# Tatoeba). Run from this directory after editing export-src/, then
# update the hashes in pin.json (sha256sum export/*).
set -euo pipefail
cd "$(dirname "$0")"
rm -f export/*
for name in sentences_detailed sentences_CC0 tags user_languages; do
  tar --sort=name --owner=0 --group=0 --numeric-owner --mtime='2000-01-01 00:00:00Z' \
    -C export-src -cf - "$name.csv" | bzip2 -9 >"export/$name.tar.bz2"
done
bzip2 -9 -c export-src/links.csv >export/links.csv.bz2
cp export-src/users_sentences.csv export/users_sentences.csv
sha256sum export/*
