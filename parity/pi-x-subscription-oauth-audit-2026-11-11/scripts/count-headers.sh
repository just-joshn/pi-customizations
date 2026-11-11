#!/bin/sh
awk -F'|' -v absent='—' '
  /^## Body/ { exit }
  /^\| `/ {
    header = $2; grokValue = $3; piValue = $4
    gsub(/ /, "", grokValue); gsub(/ /, "", piValue)
    if (grokValue != absent && piValue == absent) grokOnly = grokOnly " " header
    if (grokValue == absent && piValue != absent) piOnly = piOnly " " header
  }
  END {
    print "grok-only", split(grokOnly, a, " "), grokOnly
    print "pi-only", split(piOnly, b, " "), piOnly
  }
' "$(dirname "$0")/../evidence/grok-wire.md"
