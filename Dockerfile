# syntax=docker/dockerfile:1

# Web: the SvelteKit SPA. adapter-static emits build/index.html plus hashed
# assets; the Go builder embeds that directory into the binary.
FROM node:26-alpine AS web
WORKDIR /src/apps/web
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci
COPY apps/web/ ./
# The built-in plugin manifests ($builtin alias) live next to the server.
COPY server/internal/plugins/builtin /src/server/internal/plugins/builtin
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
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/qinqin ./cmd/qinqin

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
# (kanjivg-components, CC BY-SA 3.0, about 190 KB) and es-demo), so a fresh
# stack can seed itself offline:
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
ENV QINQIN_DATA=/data QINQIN_PACKS=/opt/qinqin/packs,/opt/qinqin/audio
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["qinqin"]
CMD ["serve"]
