#!/bin/sh
# Builds the Go fixture the captures used. Output is not committed (2.5 MB).
set -eu
GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -o fixture-go-macho -ldflags '-X main.banner=injected' .
