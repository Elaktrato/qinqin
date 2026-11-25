# syntax=docker/dockerfile:1

# Web: the SvelteKit SPA. adapter-static emits build/index.html plus hashed
# assets; the Go builder embeds that directory into the binary.
FROM node:26-alpine AS web
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
# Stroke-order data: the hanzi-writer-strokes pack (Arphic Public License),
# built from the pinned hanzi-writer-data devDependency into /out/strokes and
# shipped as a seed root below, not inside the SPA or the binary (see
# docs/sources.md, "Stroke-order data"). The script checks the package's
# licence text against apps/web/static/ARPHICPL.TXT.
COPY scripts/prepare-strokes-pack.mjs /src/scripts/
COPY apps/web/static/ARPHICPL.TXT ./static/ARPHICPL.TXT
RUN node /src/scripts/prepare-strokes-pack.mjs --out /out/strokes/hanzi-writer-strokes
COPY apps/web/ ./
RUN npm run build

# Builder: Go >= 1.26 is required (modernc.org/sqlite floor). Pure Go, no CGO,
# so the binary is static.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
# Replace the committed placeholder with the real SPA build so
# //go:embed all:dist ships the UI inside the binary.
RUN rm -rf ./internal/webdist/dist
COPY --from=web /src/apps/web/build ./internal/webdist/dist
# Build metadata for GET /api/version (#154): the release without its v ("dev" for
# a build that is not a tag), the commit and the commit date (RFC 3339, UTC).
ARG VERSION=dev
ARG COMMIT=
ARG BUILD_DATE=
RUN CGO_ENABLED=0 go build -trimpath \
    -ldflags="-s -w -X 'main.version=${VERSION}' -X 'main.commit=${COMMIT}' -X 'main.buildDate=${BUILD_DATE}'" \
    -o /out/qinqin ./cmd/qinqin

# Audio: the Kanji alive example-word pack (CC BY 4.0, about 69 MB), fetched
# and built here rather than committed (see docs/sources.md, "Audio").
# --build-arg WITH_AUDIO=0 skips the download; /out then stays empty, so the
# runtime stage always has an /opt/qinqin/audio root for `qinqin seed`.
FROM alpine:3.22 AS audio
ARG WITH_AUDIO=1
# Optional overrides of the pins in scripts/fetch-audio-kanjialive.sh (empty =
# the script's own value); a new upstream snapshot needs them, or a mirror.
ARG KANJIALIVE_COMMIT=
ARG KANJIALIVE_CSV_SHA256=
ARG KANJIALIVE_LICENSE_SHA256=
ARG KANJIALIVE_ZIP_SHA256=
ARG KANJIALIVE_ZIP_BYTES=
ARG KANJIALIVE_EXPECTED_CLIPS=
ARG KANJIALIVE_SNAPSHOT=
ARG KANJIALIVE_ZIP_URL=
RUN apk add --no-cache curl unzip nodejs
COPY scripts/fetch-audio-kanjialive.sh scripts/prepare-audio-kanjialive.mjs /src/scripts/
RUN mkdir -p /out && if [ "$WITH_AUDIO" = "1" ]; then sh /src/scripts/fetch-audio-kanjialive.sh /out; fi

# Pictures: the images packs images-openmoji and images-mulberry (CC BY-SA 4.0,
# about 1.7 MB and 4.6 MB of SVG), built here from the pinned upstream releases
# (scripts/images/pins.json, every file checked by SHA-256) and the committed
# word mappings (scripts/images/<pack>/map.tsv); only the pictures a mapping uses
# are kept. They are shipped as separate packs next to the binary, never compiled
# into it or into the web build (docs/sources.md, "Pictures"). --build-arg
# WITH_IMAGES=0 skips the download; /out then stays empty.
FROM alpine:3.22 AS images
ARG WITH_IMAGES=1
RUN apk add --no-cache unzip nodejs ca-certificates
COPY scripts/images-lib.mjs scripts/images-io.mjs scripts/prepare-images-pack.mjs /src/scripts/
COPY scripts/images /src/scripts/images
RUN mkdir -p /out && if [ "$WITH_IMAGES" = "1" ]; then \
      for p in openmoji mulberry; do node /src/scripts/prepare-images-pack.mjs --pack "$p" --out "/out/images-$p" --cache /tmp/images-cache || exit 1; done; \
    fi

# Runtime: alpine, not scratch — the compose healthcheck needs busybox wget.
FROM alpine:3.22
# Offline OCR for the journal's photo import: Tesseract 5 and the models for
# Chinese (simplified and traditional), Japanese and English. The tesseract
# package does not pull `eng`, so it is listed for Latin-script workspaces.
# All of these packages are Apache-2.0 (Leptonica, which Tesseract links, is
# BSD-2-Clause); they are credited on the Sources page through the journal
# plugin. Unpinned on purpose: apk pins break whenever the repository moves on.
# The server also runs without them, offline reading is then unavailable.
# They add about 193 MB; build with --build-arg WITH_OCR=0 to leave them out.
ARG WITH_OCR=1
RUN if [ "$WITH_OCR" = "1" ]; then apk add --no-cache tesseract-ocr tesseract-ocr-data-eng tesseract-ocr-data-chi_sim tesseract-ocr-data-chi_tra tesseract-ocr-data-jpn; fi
COPY --from=build /out/qinqin /usr/local/bin/qinqin
# The bundled seed packs (CC-CEDICT, Unihan, JMdict, KANJIDIC2, the Jiten
# frequency list, the HSK 3.0 character and word level lists, the
# approximate JLPT kanji level list, the KanjiVG component index
# (kanjivg-components, CC BY-SA 3.0, about 190 KB), the Chinese and
# Japanese grammar packs zh-grammar and ja-grammar, and the demo pack es-demo), so a fresh stack installs them
# offline: the first `serve` seeds everything but the demo
# (QINQIN_AUTO_SEED=0 turns that off); the demo, and a refresh after an image update, come from
#   docker compose exec qinqin qinqin seed
# The samples in plugins/samples (dictionaries and level packs) are not
# shipped. Packs on the
# host (plugins/data-local) are not in the image: mount them as a volume and
# name both roots, e.g. --packs /opt/qinqin/packs,/opt/qinqin/local. That is
# how the optional JLPT vocabulary pack (not bundled, licence chain
# unverified) is installed.
COPY plugins/data /opt/qinqin/packs
# The Kanji alive audio pack, when built with WITH_AUDIO=1 (the default); an
# empty directory otherwise.
COPY --from=audio /out /opt/qinqin/audio
# The stroke-order data pack (about 13 MB). `qinqin seed` and the first-start
# auto-seed install it with the others; `serve` also installs it by itself at
# start when no strokes pack is
# installed (an upgrade from v0.3 keeps its stroke animations), unless an
# administrator uninstalled one.
COPY --from=web /out/strokes /opt/qinqin/strokes
# The pictures packs (CC BY-SA 4.0), when built with WITH_IMAGES=1 (the default).
COPY --from=images /out /opt/qinqin/images
ENV QINQIN_DATA=/data QINQIN_PACKS=/opt/qinqin/packs,/opt/qinqin/audio,/opt/qinqin/strokes,/opt/qinqin/images
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["qinqin"]
CMD ["serve"]
