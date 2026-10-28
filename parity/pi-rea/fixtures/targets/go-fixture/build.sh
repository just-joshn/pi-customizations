#!/bin/sh
# Builds the Go fixture the captures used. Output is not committed (2.5 MB).
set -eu
go build -o fixture-go-macho -ldflags '-X main.banner=injected' .
