#!/bin/sh
# Counts headers only grok sends and only Pi sends in evidence/grok-wire.md.
awk -F'|' '/^## Body/{exit} /^\| `/{g=$3;p=$4;gsub(/ /,"",g);gsub(/ /,"",p); if(g=="—"&&p!="—")po=po" "$2; if(p=="—"&&g!="—")go=go" "$2} END{n=split(go,a," "); print "grok-only", n, go; m=split(po,b," "); print "pi-only", m, po}' "$(dirname "$0")/../evidence/grok-wire.md"
