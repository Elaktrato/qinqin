# syntax=docker/dockerfile:1

# Builder: Go >= 1.26 is required (modernc.org/sqlite floor). Pure Go, no CGO,
# so the binary is static.
FROM golang:1.26-alpine AS build
WORKDIR /src
COPY server/go.mod server/go.sum ./
RUN go mod download
COPY server/ ./
RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/qinqin ./cmd/qinqin

# Runtime: alpine, not scratch — the compose healthcheck needs busybox wget.
FROM alpine:3.22
COPY --from=build /out/qinqin /usr/local/bin/qinqin
# The committed sample packs, so a fresh stack can seed itself:
#   docker compose exec qinqin qinqin seed
COPY plugins/data /opt/qinqin/packs
ENV QINQIN_DATA=/data QINQIN_PACKS=/opt/qinqin/packs
VOLUME /data
EXPOSE 8080
ENTRYPOINT ["qinqin"]
CMD ["serve"]
