#!/bin/sh
# Counts headers only grok sends and only Pi sends in the header table of evidence/grok-wire.md.
# Table rows look like: | `header` | grok value | pi value |, with — for a header that side did not send.
awk -F'|' '
  /^## Body/ { exit }
  /^\| `/ {
    header = $2; grokValue = $3; piValue = $4
    gsub(/ /, "", grokValue); gsub(/ /, "", piValue)
    if (grokValue != "—" && piValue == "—") grokOnly = grokOnly " " header
    if (grokValue == "—" && piValue != "—") piOnly = piOnly " " header
  }
  END {
    print "grok-only", split(grokOnly, a, " "), grokOnly
    print "pi-only", split(piOnly, b, " "), piOnly
  }
' "$(dirname "$0")/../evidence/grok-wire.md"
